//! 翻译流水线：规划 → 流式请求（分片）→ 写回 → 落库 → 事件。
//!
//! 这一层只做「组装」：语言判断、Prompt、计量、传输都在 `umuo-core` 里。
//! 平台能力（Keychain、前台应用、写回）经 [`Host`] 向宿主要，结果经 [`TranslateSink`] 发出；
//! 取词、窗口定位这些留在宿主里。
//!
//! 只用一个当前模型（PRD §6.3）：分场景模型、备用顺序、月度上限换供应商与本机自动回落都已退出，
//! 失败如实交给用户，由用户重试或换模型。超时、取消、长文分片与截断保护照旧。

mod plan;

pub use plan::*;

use umuo_core::error::CoreError;
use umuo_core::transport::{self, ChatTarget, ChunkTarget, StreamOptions};
use umuo_core::{chunk, lang, prompt, provider};

use crate::event::{
    CardPayload, CardSense, DeltaPayload, DonePayload, ErrorPayload, Route, StartPayload,
    TranslateEvent, TranslateSink,
};
use crate::host::{FocusSource, Host};
use crate::requests::Ticket;
use crate::settings::Settings;
use crate::AppCore;

/// 流水线里用的发送：只认 [`TranslateSink`]，不碰窗口系统。
fn send(sink: &dyn TranslateSink, route: Route, event: impl Into<TranslateEvent>) {
    sink.send(route, event.into());
}

/// 用一张已经登记好的凭据跑一次翻译。
///
/// 划词入口要在取词**之前**登记（取词失败也要顶掉旧请求、用这张凭据报错），所以单独开放。
pub async fn run(
    core: &AppCore,
    sink: &dyn TranslateSink,
    request: Request,
    guard: Option<String>,
    ticket: Ticket,
) {
    let route = Route {
        surface: request.mode.surface(),
        request_id: ticket.id,
    };
    let deps = Deps { core, sink };
    if request.mode == Mode::Compose {
        crate::history::forget_compose(core);
    }
    if let Err(error) = translate(&deps, &request, guard.as_deref(), route, &ticket).await {
        emit_core_error(sink, route, &request.text, &error);
    }
}

/// 这次请求发往哪里：供应商、Key、端点覆盖与模型。
pub(crate) struct Endpoint {
    pub provider: &'static provider::Provider,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: String,
}

/// 按设置解析当前供应商 → 读 Key → 校验 → 端点覆盖 → 模型。文字翻译与语音后处理共用这一份。
pub(crate) fn resolve_endpoint(core: &AppCore, settings: &Settings) -> Result<Endpoint, CoreError> {
    let provider = provider::find_provider(&settings.provider_id).ok_or(CoreError::NoEngine)?;
    // 读 Keychain 失败（应用签名变了、条目 ACL 坏了）按「Key 无效」报：唯一管用的是去模型设置
    // 重新保存 Key，重试只会再失败一次。宿主的错误串不进界面文案。
    let api_key = core
        .host
        .api_key(provider.id)
        .map_err(|_| CoreError::InvalidKey)?
        .unwrap_or_default();
    // 本机供应商（Ollama / LM Studio）没有 Key 条目，照常发请求。
    if provider.requires_key() && api_key.trim().is_empty() {
        return Err(CoreError::MissingKey);
    }
    // 自定义端点没填地址时直接报错，而不是把空地址发出去。
    let base_url = settings.base_url_override(provider)?;
    let model = resolve_model(settings, provider);
    Ok(Endpoint {
        provider,
        api_key,
        base_url,
        model,
    })
}

/// 流水线向外要的全部东西：应用层状态（含宿主）与事件出口。
struct Deps<'a> {
    core: &'a AppCore,
    sink: &'a dyn TranslateSink,
}

async fn translate(
    deps: &Deps<'_>,
    request: &Request,
    guard: Option<&str>,
    route: Route,
    ticket: &Ticket,
) -> Result<(), CoreError> {
    let mode = request.mode;
    let text = request.text.as_str();
    let state = deps.core;
    // 锁只在这个语句里存活：MutexGuard 不能跨 await，否则 future 不是 Send。
    let settings: Settings = state.settings.lock().expect("设置锁不应中毒").clone();

    let Endpoint {
        provider,
        api_key,
        base_url,
        model,
    } = resolve_endpoint(state, &settings)?;

    // 语言判断与目标切换（PRD §5.2）：源语言 == 第一目标语言时改用第二目标语言。
    // 撰写窗显式选了目标语言时不做切换——那是用户的明确意图，
    // 再拿它跟第一目标语言比一遍反而会把意图改掉。
    // 检测不出源语言时用母语作为假设（PRD §7.3 的「母语」）：
    // 没有它，"撞车换第二目标语言"的规则在检测失败时就会失灵。
    let detected = lang::assume_source(lang::detect(text), &settings.native_lang);
    let source = resolve_source(request, detected.as_deref());
    // PRD §5.4 的目标语言规则：显式指定 > 按 App 记忆 > 常规规则。
    //
    // 来源 App 在**发起时**取一次，按 App 记忆与历史的「来源应用」共用：翻译要几秒，
    // 完成时再取，拿到的可能是用户已经切过去的另一个应用。两处都用不到时不取。
    let per_app = settings.uses_per_app_target();
    let records_history = settings.history_enabled && !settings.privacy_mode;
    let app_name = if per_app || records_history {
        deps.core.host.frontmost_app_name()
    } else {
        None
    };
    let remembered = app_name
        .as_deref()
        .filter(|_| per_app)
        .and_then(|app| settings.app_target_langs.get(app))
        .cloned();

    let target_code = lang::resolve_target(
        request.target_override.as_deref(),
        remembered.as_deref(),
        source,
        &settings.target_lang,
        Some(&settings.secondary_target_lang),
    );

    // 用户为这个 App 手动选过语言：记下来，下次不用再选（PRD §5.4）。
    // **不做隐式学习**：只记用户明确选过的，因为"我们记住了什么"必须能被看见和删掉。
    if per_app {
        if let (Some(app), Some(chosen)) = (
            app_name.as_deref(),
            request
                .target_override
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty()),
        ) {
            if settings.app_target_langs.get(app).map(String::as_str) != Some(chosen) {
                // 对**最新**设置打补丁，而不是把请求开始时的快照整份写回：中间隔着 Keychain 查询，
                // 这段时间里用户在设置窗改的、或在外部改过文件的东西都不能被冲掉。
                // 存不下也不影响这次翻译，只是下次还得再选一次。
                state.update_settings(|latest| latest.remember_app_target(app, chosen));
            }
        }
    }
    let target_name = lang::display_name(&target_code);
    let source_name = source.map(lang::display_name);

    let vars = prompt::PromptVars {
        source_lang: source_name.as_deref(),
        target_lang: &target_name,
    };

    // 单选一个词（≤3 个词）时走词卡（PRD §5.2），其余的走普通翻译。
    // 判定与 Prompt 都来自核心层的同一份实现，客户端不重复写一遍。
    // 原地替换要把结果写回用户的输入框：那里要的是译文，词卡 JSON 绝不能写进去。
    let word_mode = !mode.write_back() && umuo_core::word_card::is_word_mode(text);
    // 写回时原文已是目标语言就原样输出，不能像浮窗那样给一句释义（会替换掉用户的原文）。
    let build_request = if mode.write_back() {
        prompt::build_write_back_request
    } else {
        prompt::build_translation_request
    };
    let chat = if word_mode {
        umuo_core::word_card::build_request(text, &vars)
    } else {
        build_request(&vars, text)
    };

    let start = StartPayload {
        text: text.to_string(),
        provider: provider.label.to_string(),
        model: model.clone(),
        target_lang: target_name.clone(),
        word_mode,
        mode: mode.as_str(),
    };
    if ticket.cancel.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(CoreError::Cancelled);
    }
    send(deps.sink, route, start);

    let options = StreamOptions {
        timeout: transport::DEFAULT_TIMEOUT,
        cancel: Some(&ticket.cancel),
        allow_empty: false,
    };
    let context_tokens = provider::context_window_for(&model);

    // PRD §6.3：超过模型上下文 70%，或译文装不进一次请求的输出上限时，
    // 按段落切分**并发**请求，结果按顺序合并。词卡模式永不切分：它处理的本来就是 ≤3 个词。
    let outcome = if !word_mode && chunk::needs_splitting(text, context_tokens) {
        let budget = chunk::char_budget(context_tokens, chunk::cjk_ratio(text));
        // 每片原文单独放入 user 消息，使用相同的内部系统指令。
        // 分隔符随片一起带上，合并译文时还原原文的段间空行。
        let pieces = chunk::split(text, budget);
        let requests: Vec<_> = pieces
            .iter()
            .map(|piece| build_request(&vars, &piece.text))
            .collect();
        let separators: Vec<String> = pieces.into_iter().map(|piece| piece.separator).collect();
        let mut sink = |delta: &str| {
            send(
                deps.sink,
                route,
                DeltaPayload {
                    text: delta.to_string(),
                },
            );
        };
        transport::stream_chunks(
            &state.client,
            &ChunkTarget {
                provider,
                base_url: base_url.as_deref(),
                model: &model,
                api_key: &api_key,
            },
            &requests,
            &separators,
            &options,
            &mut sink,
        )
        .await?
    } else {
        let mut sink = |delta: &str| {
            // 词卡模式下模型返回的是 JSON，**不能**把它逐字打到界面上——
            // 用户会看到 `{"word":"hello","senses":[{"part_of_speech"` 这种半截结构。
            // 等整段回来解析成词卡再一次性推给前端。
            if word_mode {
                return;
            }
            send(
                deps.sink,
                route,
                DeltaPayload {
                    text: delta.to_string(),
                },
            );
        };
        transport::stream_chat(
            &state.client,
            &ChatTarget {
                provider,
                base_url: base_url.as_deref(),
                model: &model,
                api_key: &api_key,
                chat: &chat,
            },
            &options,
            &mut sink,
        )
        .await?
    };

    if ticket.cancel.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(CoreError::Cancelled);
    }

    // 静默翻译在这里把结果写回原处。上面任何失败都已经提前返回、没碰用户的内容，
    // 这是 §5.4「失败时不修改原文」的落点：不是靠 try/finally，而是靠「只有成功才走到这里」。
    let replaced = match request.focus_source {
        Some(source) if mode.write_back() => {
            // 半截译文不能替换原文（审查 M4）。
            if outcome.truncated {
                return Err(CoreError::Truncated);
            }
            // 只有空白的「译文」同样不能写回：传输层只拦完全为空的流，模型只回一个换行时
            // 会走到这里，写回就把用户选中的原文换成了空白。
            if outcome.text.trim().is_empty() {
                return Err(CoreError::BadResponse {
                    detail: "模型只返回了空白，没有替换原文".to_string(),
                });
            }
            write_back_focus(
                &*deps.core.host,
                guard,
                source,
                &request.text,
                &outcome.text,
            )?;
            true
        }
        _ => false,
    };

    // 词卡：解析成功后发结构化卡片；解析失败**降级为纯文本**（PRD §6.5）。
    // 降级时必须把原文补发一次——词卡模式下我们抑制了流式增量，
    // 否则界面上会是一片空白，用户以为翻译没出结果。
    let history_text = if word_mode {
        match umuo_core::word_card::parse(&outcome.text) {
            Ok(card) => {
                send(
                    deps.sink,
                    route,
                    CardPayload {
                        word: card.word.clone(),
                        phonetic: card.phonetic.clone(),
                        senses: card
                            .senses
                            .iter()
                            .map(|sense| CardSense {
                                part_of_speech: sense.part_of_speech.clone(),
                                definition: sense.definition.clone(),
                            })
                            .collect(),
                    },
                );
                // 历史里放用户真正读到的那句释义，而不是一整段 JSON。
                card.senses
                    .first()
                    .map(|sense| sense.definition.clone())
                    .unwrap_or_else(|| card.word.clone())
            }
            Err(_) => {
                send(
                    deps.sink,
                    route,
                    DeltaPayload {
                        text: outcome.text.clone(),
                    },
                );
                outcome.text.clone()
            }
        }
    } else {
        outcome.text.clone()
    };

    // 记历史。放在 done 之前：浮窗显示与落库是同一次成功的两个后果，
    // 而落库失败只打日志、不影响用户看到译文。
    // 截断的不进历史：历史里的译文会被当成完整结果复制、再利用。
    // 撰写窗边打边翻，这里只暂存，用户提交那一版时才记（`history::commit_compose`）。
    if !outcome.truncated {
        let draft = crate::history::Draft {
            source_text: text.to_string(),
            translated_text: history_text,
            source_lang: source.map(str::to_string),
            target_lang: target_name.clone(),
            provider_id: provider.id.to_string(),
            model: model.clone(),
            style_id: prompt::DEFAULT_STYLE_ID.to_string(),
            scene: mode.as_str().to_string(),
            source_app: app_name,
            input_tokens: outcome.usage.input_tokens,
            output_tokens: outcome.usage.output_tokens,
            estimated: outcome.usage.estimated,
        };
        if mode == Mode::Compose {
            crate::history::hold_compose(deps.core, route.request_id, draft);
        } else {
            crate::history::record(deps.core, draft);
        }
    }

    send(
        deps.sink,
        route,
        DonePayload {
            warning: done_warning(outcome.truncated),
            model,
            input_tokens: outcome.usage.input_tokens,
            output_tokens: outcome.usage.output_tokens,
            estimated: outcome.usage.estimated,
            first_token_ms: outcome.first_token_ms,
            total_ms: outcome.total_ms,
            replaced,
        },
    );
    Ok(())
}

/// 静默翻译的写回（PRD §5.4）：按读取时的来源替换选区或整个输入框。
///
/// 与浮窗的写回分开：这条路**没有 ⌘V 兜底**，写不进去就如实报告失败。
fn write_back_focus(
    host: &dyn Host,
    target: Option<&str>,
    source: FocusSource,
    original: &str,
    text: &str,
) -> Result<(), CoreError> {
    // 翻译花了几秒，用户完全可能已经切到别的窗口。这时写回等于把译文打进
    // 另一个应用——宁可不替换，也不能写错地方。
    if !target_still_matches(target, host.frontmost_app_token()) {
        return Err(CoreError::WriteTargetChanged);
    }

    host.write_back(source, original, text)
        .map_err(|detail| CoreError::WriteBackFailed { detail })
}

fn emit_core_error(sink: &dyn TranslateSink, route: Route, source: &str, error: &CoreError) {
    send(
        sink,
        route,
        ErrorPayload {
            message: error.to_string(),
            actions: error.actions(),
            needs_permission: false,
            permission: None,
            source: Some(source.to_string()),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_go_to_the_window_the_mode_belongs_to() {
        // 窗口标签是宿主与流水线共用的契约：Swift 按它把事件分给浮窗或撰写窗。
        assert_eq!(PANEL_SURFACE, "panel");
        assert_eq!(COMPOSE_SURFACE, "compose");
        for mode in [Mode::Selection, Mode::SilentReplace, Mode::Ocr] {
            assert_eq!(mode.surface(), PANEL_SURFACE);
        }
        assert_eq!(Mode::Compose.surface(), COMPOSE_SURFACE);
    }
}
