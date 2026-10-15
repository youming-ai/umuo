//! 多模型对比（PRD §5.6）。
//!
//! 与其它三个功能最大的不同：它**并发**对 N 个模型发同一份 prompt，每个都是真实计费请求。
//! 因此这里有两件事必须做对：
//!
//! 1. **候选要先去重再截断**（[`umuo_core::router::compare_candidates`]）——
//!    重复候选会让用户看到两张一样的卡片、却各付一次钱。
//! 2. **每个模型的增量要带下标**，否则 N 路流式输出会串进同一张卡片里。
//!
//! 复用同一份 prompt：对比的意义就是「同一句话、不同模型」，各写各的 prompt
//! 比出来的东西说明不了任何问题。

use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use umuo_core::router::{self, MAX_COMPARE_MODELS};
use umuo_core::transport::{self, ChatTarget, StreamOptions};
use umuo_core::wire::ModelRef;
use umuo_core::{lang, prompt, provider, usage};
use umuo_platform::{SecretStore, SelectionReader};

use crate::settings::Settings;
use crate::{AppState, COMPARE_LABEL};

pub const EVENT_START: &str = "compare://start";
pub const EVENT_DELTA: &str = "compare://delta";
pub const EVENT_DONE: &str = "compare://done";
pub const EVENT_ERROR: &str = "compare://error";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub index: usize,
    /// 供应商**id**：前端要拿它拼「选它」的偏好键，展示名不能用来当键。
    pub provider_id: String,
    pub provider: String,
    pub model: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPayload {
    pub text: String,
    pub target_lang: String,
    pub cards: Vec<Card>,
}

#[derive(Clone, Serialize)]
pub struct DeltaPayload {
    pub index: usize,
    pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DonePayload {
    pub index: usize,
    pub model: String,
    /// 端到端耗时。对比场景里这是用户真正在比较的东西之一。
    pub total_ms: u64,
    pub first_token_ms: Option<u64>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated: bool,
    pub cost_usd: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub index: usize,
    pub message: String,
}

/// 决定这次对比发给哪些模型。
///
/// 优先级：**用户在设置里勾选的供应商** → 没勾时自动挑「已配置 Key 的供应商」。
/// 自动挑选让刚填完一两把 Key 的用户不必先去配置页配一遍就能用上对比；
/// 显式勾选则给他们完全的控制权。
///
/// `has_key` 是注入进来的判断，而不是直接读 Keychain——这样这条规则可以纯函数测试，
/// 不需要真的往系统钥匙串里写东西。
pub fn plan_candidates(
    settings: &Settings,
    has_key: impl Fn(&str) -> bool,
    over_budget: impl Fn(&str) -> bool,
) -> Vec<ModelRef> {
    let model_for = |provider_id: &str| -> Option<String> {
        let catalog = provider::find_provider(provider_id)?;
        // 当前供应商用用户填的模型；其它供应商用它自己的默认模型。
        // 本机模型（Ollama / LM Studio）的 default_model 是空的——它们必须先探测出
        // 可用模型，这里没有可靠的名字可填，于是直接跳过，而不是编一个。
        let model = if provider_id == settings.provider_id && !settings.model.trim().is_empty() {
            settings.model.trim().to_string()
        } else {
            catalog.default_model.to_string()
        };
        (!model.is_empty()).then_some(model)
    };

    // 对比模型的来源只有一处是权威的，优先级从高到低：
    //
    //   1. `scene_models.compare`：显式指定「供应商 + 模型」。
    //      它比下面那个供应商清单表达力更强（可以对比同一家的两个模型），
    //      所以非空时**完全接管**，而不是与它合并——两个来源混在一起，
    //      用户永远说不清最终到底发了哪几个模型。
    //   2. `compare_providers`：只挑供应商，模型用各自的默认值。
    //   3. 都没配：自动用所有已配 Key 且能确定模型的供应商。
    let explicit: Vec<ModelRef> = settings
        .scene_models
        .compare
        .iter()
        .filter(|candidate| has_key(&candidate.provider_id) && !candidate.model.trim().is_empty())
        .cloned()
        .collect();

    let selected: Vec<ModelRef> = if !explicit.is_empty() {
        explicit
    } else if settings.compare_providers.is_empty() {
        provider::PROVIDERS
            .iter()
            .filter(|entry| has_key(entry.id))
            .filter_map(|entry| {
                model_for(entry.id).map(|model| ModelRef {
                    provider_id: entry.id.to_string(),
                    model,
                })
            })
            .collect()
    } else {
        settings
            .compare_providers
            .iter()
            .filter(|id| has_key(id))
            .filter_map(|id| {
                model_for(id).map(|model| ModelRef {
                    provider_id: id.clone(),
                    model,
                })
            })
            .collect()
    };

    let capped = router::compare_candidates(selected);

    // 月度上限（PRD §5.10）。对比本身就是一次**多倍**支出，让已经超限的供应商
    // 再花四倍钱是最不该发生的事，所以超限的直接不参与。
    let affordable: Vec<ModelRef> = capped
        .iter()
        .filter(|candidate| !over_budget(&candidate.provider_id))
        .cloned()
        .collect();

    // 一个都没剩下就退回原清单：用户按下快捷键是为了对比，
    // 不是为了看到一张空窗口。这时候额度约束让位于「他要这个结果」。
    if affordable.is_empty() {
        capped
    } else {
        affordable
    }
}

/// 快捷键 / 托盘触发的入口。取词与划词翻译同源（选区优先，失败降级复制）。
pub fn trigger(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let read = app.state::<AppState>().selection.read_selection();
        let text = match read {
            Ok(text) => text,
            Err(error) => {
                crate::show_compare(&app);
                emit_platform_error(&app, &error);
                return;
            }
        };
        crate::show_compare(&app);
        tauri::async_runtime::spawn(async move {
            run(app, text).await;
        });
    });
}

/// 从命令（撰写窗之外的入口）发起一次对比。
pub fn spawn(app: &AppHandle, text: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run(app, text).await;
    });
}

async fn run(app: AppHandle, text: String) {
    let state = app.state::<AppState>();
    let settings: Settings = state.settings.lock().expect("设置锁不应中毒").clone();
    let client = state.client.clone();
    let cancel = state.cancel.clone();

    let has_key = |id: &str| -> bool {
        app.state::<AppState>()
            .secrets
            .get(id)
            .ok()
            .flatten()
            .is_some_and(|key| !key.trim().is_empty())
    };
    // 本月各供应商的花费。读不到就当成都没超限——历史库坏了不该让对比用不了。
    let spends = crate::history::with_store(&app, |store| {
        store.usage_by_provider(store.month_start_unix()?)
    })
    .unwrap_or_default();
    let over_budget = |id: &str| -> bool {
        let spent = spends
            .iter()
            .find(|row| row.provider_id == id)
            .map(|row| row.cost_usd)
            .unwrap_or(0.0);
        umuo_core::budget::Budget::new(
            spent,
            umuo_core::budget::limit_for(&settings.monthly_limits, id),
        )
        .is_over()
    };
    let candidates = plan_candidates(&settings, has_key, over_budget);

    if candidates.is_empty() {
        let _ = app.emit_to(
            COMPARE_LABEL,
            EVENT_ERROR,
            ErrorPayload {
                index: 0,
                message: "没有可用于对比的模型：先在设置里为至少两个供应商填好 API Key".to_string(),
            },
        );
        return;
    }

    // 与其它场景共用同一份 prompt 与语言判断：对比的前提是「同一句话、不同模型」。
    // 术语表同理——四条流必须用同一份术语约束，否则对比出来的差异里混进了术语口径的差异。
    let source = lang::detect(&text);
    let target_code = lang::pick_target(
        source,
        &settings.target_lang,
        Some(&settings.secondary_target_lang),
    );
    let target_name = lang::display_name(&target_code);
    let source_name = source.map(lang::display_name);
    // 内置与用户自建预设走同一条查找路径（PRD §5.7）。
    let style = settings.style();
    // `state` 必须先绑到变量上：直接把 `app.state::<AppState>()` 写在表达式里，
    // 那个临时值会在语句结束时被释放，而借出它的锁还要用。
    let glossary_block = {
        let state = app.state::<AppState>();
        let store = state.glossaries.lock().expect("术语表锁不应中毒");
        crate::glossaries::Glossaries::block_for(&store.lists, source, &target_code, &text)
    };
    let vars = prompt::PromptVars {
        source_lang: source_name.as_deref(),
        target_lang: &target_name,
        glossary: glossary_block.as_deref(),
        app_name: None,
    };
    let chat = prompt::build_translation_request(&style, &vars, &text);

    // 一次请求一个共享的取消标志：用户按 Esc 时 N 路一起停。
    cancel.store(false, Ordering::Relaxed);

    let cards: Vec<Card> = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| Card {
            index,
            provider_id: candidate.provider_id.clone(),
            provider: provider::find_provider(&candidate.provider_id)
                .map(|entry| entry.label.to_string())
                .unwrap_or_else(|| candidate.provider_id.clone()),
            model: candidate.model.clone(),
        })
        .collect();

    let _ = app.emit_to(
        COMPARE_LABEL,
        EVENT_START,
        StartPayload {
            text: text.clone(),
            target_lang: target_name.clone(),
            cards,
        },
    );

    // 逐张卡片并发发起。顺序 spawn、顺序收集，但网络上是并行的——
    // 串行发会让第 4 张卡片等到前 3 张都跑完，用户看到的是「一张一张慢慢出」。
    let mut tasks = Vec::with_capacity(candidates.len());
    for (index, candidate) in candidates.iter().enumerate().take(MAX_COMPARE_MODELS) {
        let Some(entry) = provider::find_provider(&candidate.provider_id) else {
            continue;
        };
        let api_key = app
            .state::<AppState>()
            .secrets
            .get(entry.id)
            .ok()
            .flatten()
            .unwrap_or_default();

        let base_url = match settings.base_url_override(entry) {
            Ok(url) => url,
            Err(_) => {
                // 自定义端点没填地址：这张卡必然失败，直接在卡片上说明原因，
                // 而不是发一个 URL 为空的请求。
                let _ = app.emit_to(
                    COMPARE_LABEL,
                    EVENT_ERROR,
                    ErrorPayload {
                        index,
                        message: "自定义端点还没填 Base URL".to_string(),
                    },
                );
                continue;
            }
        };
        let app_for_task = app.clone();
        let client = client.clone();
        let cancel = cancel.clone();
        let chat = chat.clone();
        let model = candidate.model.clone();
        let provider_id = candidate.provider_id.clone();
        // 写历史要用到的东西，必须为每张卡各复制一份——任务会 move 走它们。
        let source_text = text.clone();
        let source_lang = source.map(str::to_string);
        let target_lang = target_name.clone();
        let style_id = settings.style_id.clone();

        tasks.push(tauri::async_runtime::spawn(async move {
            let mut sink = |delta: &str| {
                let _ = app_for_task.emit_to(
                    COMPARE_LABEL,
                    EVENT_DELTA,
                    DeltaPayload {
                        index,
                        text: delta.to_string(),
                    },
                );
            };

            let outcome = transport::stream_chat(
                &client,
                &ChatTarget {
                    provider: entry,
                    base_url: base_url.as_deref(),
                    model: &model,
                    api_key: &api_key,
                    chat: &chat,
                },
                &StreamOptions {
                    timeout: router::DEFAULT_TIMEOUT,
                    cancel: Some(&cancel),
                },
                &mut sink,
            )
            .await;

            match outcome {
                Ok(outcome) => {
                    let price = usage::builtin_price(&provider_id, &model);
                    let cost_usd = price.map(|p| usage::cost_usd(outcome.usage, p));

                    // 对比里每一张成功落地的卡片都是一次真实的翻译，都进历史。
                    // 用 `compare` 场景标签区分，用户能在历史里看出「这四条是同一次对比」。
                    crate::history::record(
                        &app_for_task,
                        crate::history::Draft {
                            source_text: source_text.clone(),
                            translated_text: outcome.text.clone(),
                            source_lang: source_lang.clone(),
                            target_lang: target_lang.clone(),
                            provider_id: provider_id.clone(),
                            model: model.clone(),
                            style_id: style_id.clone(),
                            scene: "compare".to_string(),
                            input_tokens: outcome.usage.input_tokens,
                            output_tokens: outcome.usage.output_tokens,
                            estimated: outcome.usage.estimated,
                            cost_usd,
                        },
                    );

                    let _ = app_for_task.emit_to(
                        COMPARE_LABEL,
                        EVENT_DONE,
                        DonePayload {
                            index,
                            model: model.clone(),
                            total_ms: outcome.total_ms,
                            first_token_ms: outcome.first_token_ms,
                            input_tokens: outcome.usage.input_tokens,
                            output_tokens: outcome.usage.output_tokens,
                            estimated: outcome.usage.estimated,
                            cost_usd,
                        },
                    );
                }
                Err(error) => {
                    let _ = app_for_task.emit_to(
                        COMPARE_LABEL,
                        EVENT_ERROR,
                        ErrorPayload {
                            index,
                            message: error.to_string(),
                        },
                    );
                }
            }
        }));
    }

    for task in tasks {
        let _ = task.await;
    }
}

fn emit_platform_error(app: &AppHandle, error: &umuo_platform::PlatformError) {
    let _ = app.emit_to(
        COMPARE_LABEL,
        EVENT_ERROR,
        ErrorPayload {
            index: 0,
            message: error.to_string(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_with(compare: &[&str], provider: &str, model: &str) -> Settings {
        Settings {
            provider_id: provider.to_string(),
            model: model.to_string(),
            compare_providers: compare.iter().map(|s| s.to_string()).collect(),
            ..Settings::default()
        }
    }

    #[test]
    fn auto_mode_picks_providers_that_have_keys_and_never_the_ones_that_do_not() {
        // 没有 Key 的供应商出现在卡片里，用户按下快捷键只会看到一排红色报错。
        let settings = settings_with(&[], "openai", "gpt-4o-mini");
        let has_key = |id: &str| id == "openai" || id == "deepseek";
        let chosen = plan_candidates(&settings, has_key, |_| false);

        let ids: Vec<&str> = chosen.iter().map(|m| m.provider_id.as_str()).collect();
        assert_eq!(ids, vec!["openai", "deepseek"]);
    }

    #[test]
    fn the_active_provider_uses_the_configured_model_and_others_use_their_defaults() {
        let settings = settings_with(&[], "openai", "my-custom-model");
        let has_key = |_: &str| true;
        let chosen = plan_candidates(&settings, has_key, |_| false);

        assert_eq!(
            chosen[0].model, "my-custom-model",
            "当前供应商用用户填的模型"
        );
        let deepseek = chosen.iter().find(|m| m.provider_id == "deepseek").unwrap();
        assert_eq!(
            deepseek.model, "deepseek-chat",
            "其它供应商用它自己的默认模型"
        );
    }

    #[test]
    fn explicit_selection_wins_and_keeps_the_users_order() {
        let settings = settings_with(&["deepseek", "openai"], "openai", "gpt-4o-mini");
        let chosen = plan_candidates(&settings, |_: &str| true, |_| false);
        assert_eq!(
            chosen
                .iter()
                .map(|m| m.provider_id.as_str())
                .collect::<Vec<_>>(),
            vec!["deepseek", "openai"],
        );
    }

    #[test]
    fn explicit_selection_still_skips_providers_without_keys() {
        let settings = settings_with(&["deepseek", "openai"], "openai", "gpt-4o-mini");
        let chosen = plan_candidates(&settings, |id: &str| id == "openai", |_| false);
        assert_eq!(chosen.len(), 1);
        assert_eq!(chosen[0].provider_id, "openai");
    }

    #[test]
    fn local_providers_are_skipped_because_they_have_no_static_model_name() {
        // Ollama / LM Studio 的 default_model 是空的（必须先探测），
        // 编一个模型名出来只会让那一格必然报错。
        let settings = settings_with(&[], "ollama", "");
        let chosen = plan_candidates(&settings, |_: &str| true, |_| false);
        assert!(
            !chosen.iter().any(|m| m.provider_id == "ollama"),
            "本机模型不该被自动选入对比"
        );
    }

    #[test]
    fn at_most_four_cards_even_when_every_provider_has_a_key() {
        let settings = settings_with(&[], "openai", "gpt-4o-mini");
        let chosen = plan_candidates(&settings, |_: &str| true, |_| false);
        assert!(
            chosen.len() <= MAX_COMPARE_MODELS,
            "实际 {} 张",
            chosen.len()
        );
        assert_eq!(chosen.len(), MAX_COMPARE_MODELS);
    }

    #[test]
    fn no_keys_means_no_cards_rather_than_a_fake_one() {
        let settings = settings_with(&[], "openai", "gpt-4o-mini");
        assert!(plan_candidates(&settings, |_: &str| false, |_| false).is_empty());
    }

    #[test]
    fn explicitly_listed_compare_models_take_over_completely() {
        // 两个来源混在一起，用户永远说不清最终到底发了哪几个模型。
        let settings = Settings {
            compare_providers: vec!["openai".into(), "deepseek".into()],
            scene_models: umuo_core::router::SceneModels {
                compare: vec![
                    umuo_core::wire::ModelRef {
                        provider_id: "openai".into(),
                        model: "gpt-4o".into(),
                    },
                    umuo_core::wire::ModelRef {
                        provider_id: "openai".into(),
                        model: "gpt-4o-mini".into(),
                    },
                ],
                ..Default::default()
            },
            ..Settings::default()
        };
        let chosen = plan_candidates(&settings, |_: &str| true, |_| false);
        assert_eq!(chosen.len(), 2, "实际：{chosen:?}");
        assert!(chosen.iter().all(|c| c.provider_id == "openai"));
        assert!(
            !chosen.iter().any(|c| c.provider_id == "deepseek"),
            "显式清单应当完全接管，而不是与 compare_providers 合并"
        );
    }

    #[test]
    fn an_explicit_compare_model_can_pick_a_non_default_model() {
        // 这正是供应商级清单做不到的事：对比同一家的两个模型。
        let settings = Settings {
            scene_models: umuo_core::router::SceneModels {
                compare: vec![umuo_core::wire::ModelRef {
                    provider_id: "openai".into(),
                    model: "gpt-4o".into(),
                }],
                ..Default::default()
            },
            ..Settings::default()
        };
        let chosen = plan_candidates(&settings, |_: &str| true, |_| false);
        assert_eq!(chosen[0].model, "gpt-4o", "不该被换成默认模型");
    }

    #[test]
    fn an_explicit_compare_model_without_a_key_is_skipped() {
        // 没有 Key 的候选发出去只会 401，占用一张必然失败的卡片位置。
        let settings = Settings {
            scene_models: umuo_core::router::SceneModels {
                compare: vec![
                    umuo_core::wire::ModelRef {
                        provider_id: "openai".into(),
                        model: "gpt-4o".into(),
                    },
                    umuo_core::wire::ModelRef {
                        provider_id: "deepseek".into(),
                        model: "deepseek-chat".into(),
                    },
                ],
                ..Default::default()
            },
            ..Settings::default()
        };
        let chosen = plan_candidates(&settings, |id: &str| id == "deepseek", |_| false);
        assert_eq!(chosen.len(), 1);
        assert_eq!(chosen[0].provider_id, "deepseek");
    }

    #[test]
    fn an_explicit_compare_model_with_a_blank_model_name_falls_back() {
        // 空模型名不是一条可用的候选；把它当成「用户没配」回落到供应商清单，
        // 而不是发一个模型名为空的请求出去。
        let settings = Settings {
            compare_providers: vec!["deepseek".into()],
            scene_models: umuo_core::router::SceneModels {
                compare: vec![umuo_core::wire::ModelRef {
                    provider_id: "openai".into(),
                    model: "   ".into(),
                }],
                ..Default::default()
            },
            ..Settings::default()
        };
        let chosen = plan_candidates(&settings, |_: &str| true, |_| false);
        assert_eq!(chosen.len(), 1);
        assert_eq!(chosen[0].provider_id, "deepseek", "应当回落到供应商清单");
    }

    #[test]
    fn an_over_budget_provider_is_left_out_of_the_comparison() {
        // 对比是一次多倍支出。让已经超限的供应商再花四倍钱是最不该发生的事。
        let settings = Settings {
            compare_providers: vec!["openai".into(), "deepseek".into()],
            ..Settings::default()
        };
        let chosen = plan_candidates(&settings, |_: &str| true, |id: &str| id == "openai");
        assert!(!chosen.iter().any(|c| c.provider_id == "openai"));
        assert!(chosen.iter().any(|c| c.provider_id == "deepseek"));
    }

    #[test]
    fn the_comparison_still_happens_when_every_provider_is_over_budget() {
        // 全超限时退回原清单：用户按下快捷键是为了对比，不是为了看一张空窗口。
        // 额度约束在这里让位于「他要这个结果」，缺的那部分由浮窗的提醒补上。
        let settings = Settings {
            compare_providers: vec!["openai".into(), "deepseek".into()],
            ..Settings::default()
        };
        let chosen = plan_candidates(&settings, |_: &str| true, |_: &str| true);
        assert!(!chosen.is_empty(), "不该因为额度全部超限就什么都不给");
    }
}
