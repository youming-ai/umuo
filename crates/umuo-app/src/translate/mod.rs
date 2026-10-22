//! 翻译流水线：规划 → 流式请求（故障转移、离线回落、分片）→ 记账 → 写回 → 落库 → 事件。
//!
//! 这一层只做「组装」：语言判断、Prompt、路由、计量、传输都在 `umuo-core` 里。
//! 平台能力（Keychain、前台应用、写回）经 [`Host`](crate::Host) 向宿主要，结果经 [`TranslateSink`] 发出；
//! 取词、窗口定位这些留在宿主里。

mod plan;

pub use plan::*;

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use umuo_core::error::CoreError;
use umuo_core::router;
use umuo_core::transport::{self, ChatTarget, StreamOptions};
use umuo_core::wire::ModelRef;
use umuo_core::{chunk, lang, prompt, provider, usage};

use crate::event::{
    CardExample, CardPayload, CardSense, DeltaPayload, DonePayload, ErrorPayload, Route,
    StartPayload, TranslateEvent, TranslateSink,
};
use crate::host::{FocusSource, Host};
use crate::requests::Ticket;
use crate::settings::Settings;
use crate::AppCore;

/// 流水线里用的发送：只认 [`TranslateSink`]，不碰窗口系统。
fn send(sink: &dyn TranslateSink, route: Route, event: impl Into<TranslateEvent>) {
    sink.send(route, event.into());
}

/// 故障转移换候选之前重发一次 start，让前端丢掉上一个候选已经流出的增量。
///
/// 前端的 delta 只追加、done 也不带全文；同一个请求 id 的 start 会整体重置译文并保持
/// streaming（`panel-state` 的 reducer 只拒绝**更旧**的 id）。供应商与模型换成这次
/// 真正要试的候选，状态行就不会还显示已经失败的那家。
fn emit_restart(
    sink: &dyn TranslateSink,
    route: Route,
    start: &StartPayload,
    provider: &provider::Provider,
    model: &str,
) {
    send(
        sink,
        route,
        StartPayload {
            provider: provider.label.to_string(),
            model: model.to_string(),
            ..start.clone()
        },
    );
}

/// 跑一批分片请求。
///
/// 抽成函数是为了让「离线回落」能**原样再跑一次**——否则那 15 行请求代码
/// 要在两条路径上各写一份，而且迟早只有一份被改。
#[allow(clippy::too_many_arguments)]
async fn run_chunks(
    client: &reqwest::Client,
    provider: &'static provider::Provider,
    base_url: Option<&str>,
    model: &str,
    api_key: &str,
    requests: &[umuo_core::wire::ChatRequest],
    separators: &[String],
    options: &transport::StreamOptions<'_>,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> Result<transport::StreamOutcome, CoreError> {
    transport::stream_chunks(
        client,
        &transport::ChunkTarget {
            provider,
            base_url,
            model,
            api_key,
        },
        requests,
        separators,
        options,
        on_delta,
    )
    .await
}

/// 本机可用的兜底候选：探测 Ollama，其次 LM Studio。
///
/// **必须真的能列出模型才算可用。** 装了 Ollama 但没启动、或一个模型都没下时，
/// 把它当兜底只会把「网络不可达」变成「连接被拒绝」——错误更难懂，还多等一轮超时。
async fn local_candidate(
    client: &reqwest::Client,
    settings: &Settings,
) -> Option<umuo_core::wire::ModelRef> {
    for provider in provider::PROVIDERS
        .iter()
        .filter(|p| p.kind == provider::ProviderKind::Local)
    {
        // 用户可能改过本地地址（例如换了端口），所以要经过同一套覆盖解析。
        let Ok(base_url) = settings.base_url_override(provider) else {
            continue;
        };
        let wire = match base_url.as_deref() {
            Some(url) => umuo_core::wire::build_models_request_at(provider, url, ""),
            None => umuo_core::wire::build_models_request(provider, ""),
        };
        let Ok(wire) = wire else {
            continue;
        };
        // 本地探测给短的超时：本机连不上是立刻知道的，不该让用户等 15 秒。
        let Ok(body) = transport::fetch_json(client, &wire, Duration::from_secs(5)).await else {
            continue;
        };
        let Ok(models) = umuo_core::wire::parse_models_list(provider.protocol, &body) else {
            continue;
        };
        if let Some(model) = models.into_iter().next() {
            return Some(umuo_core::wire::ModelRef {
                provider_id: provider.id.to_string(),
                model,
            });
        }
    }
    None
}

impl AppCore {
    /// 从别处传入文本时用这个：浮窗的「重译」按钮、撰写窗的翻译命令、截图 OCR 的结果。
    ///
    /// `guard` 只有静默翻译才需要——它是写回前的目标校验凭据。
    ///
    /// 登记在调用时**同步**完成：新请求立刻顶掉同一窗口的旧请求，不必等异步任务排上队。
    /// 返回的 future 由宿主放到自己的运行时上跑。
    pub fn start_translation(
        self: &Arc<Self>,
        request: Request,
        guard: Option<String>,
        sink: Arc<dyn TranslateSink>,
    ) -> impl Future<Output = ()> + Send + 'static {
        let ticket = self.requests.begin(request.mode.surface());
        let core = self.clone();
        async move { run(&core, &*sink, request, guard, ticket).await }
    }
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
        back: request.back,
    };
    let deps = Deps { core, sink };
    if let Err(error) = translate(&deps, &request, guard.as_deref(), route, &ticket).await {
        emit_core_error(sink, route, &request.text, &error);
    }
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

    let provider = provider::find_provider(resolve_provider_id(&settings, request))
        .ok_or(CoreError::NoEngine)?;

    // 首选供应商的 Key。**只用于「首选是否可用」的判断**——循环里每个候选会各自
    // 重新解析自己的 Key 与地址（见下面的注释）。
    let primary_key = deps
        .core
        .host
        .api_key(provider.id)
        .map_err(|e| CoreError::BadResponse {
            detail: format!("读取 Keychain 失败：{e}"),
        })?
        .unwrap_or_default();
    if provider.requires_key() && primary_key.trim().is_empty() {
        return Err(CoreError::MissingKey);
    }

    // 月度上限（PRD §5.10）：可能把我们换到另一个供应商。
    // **必须放在解析模型与地址之前**——换了供应商还沿用旧供应商的模型名，
    // 请求会以一个「模型不存在」的 404 失败，而用户完全不知道为什么。
    let resolution = crate::budget::resolve(deps.core, &settings, provider.id);
    let switched = resolution.provider_id != provider.id;
    let provider = if switched {
        umuo_core::provider::find_provider(&resolution.provider_id).unwrap_or(provider)
    } else {
        provider
    };
    let budget_warning = resolution.warning;

    let model = if switched {
        // 被月度上限换过来时用新供应商的默认模型：用户配置的模型名属于原来那家，
        // 拿它去新端点只会 404。
        provider.default_model.to_string()
    } else {
        resolve_model(&settings, provider, request)
    };

    // 语言判断与目标切换（PRD §5.2）：源语言 == 第一目标语言时改用第二目标语言。
    // 回译会直接覆盖目标语言，此时不做切换——「翻回原文语言」是用户的明确意图，
    // 再拿它跟第一目标语言比一遍反而会把意图改掉。
    // 检测不出源语言时用母语作为假设（PRD §7.3 的「母语」）：
    // 没有它，"撞车换第二目标语言"的规则在检测失败时就会失灵。
    let detected = lang::assume_source(lang::detect(text), &settings.native_lang);
    let source = resolve_source(request, detected.as_deref());
    // PRD §5.4 的目标语言规则：显式指定 > 按 App 记忆 > 常规规则。
    //
    // 只有开了「按 App 记忆」才去读来源 App——那是一次 AX 往返（十几毫秒），
    // 默认路径不该付这个成本（PRD §8 的唤起速度门槛很紧）。
    let per_app = settings.uses_per_app_target();
    // 内置与用户自建预设走同一条查找路径（PRD §5.7）；浮窗重译可以覆盖这一次。
    let style = resolve_style(&settings, request);
    // 风格指令里写了 `{app_name}` 也要读来源 App（审查 L10）：用户自己选择了这个变量，
    // 这次 AX 往返是他要的；没写的人不付这个成本。
    let app_name = if per_app || style.instruction.contains("{app_name}") {
        deps.core.host.frontmost_app_name()
    } else {
        None
    };
    // 只为 `{app_name}` 读到的 App 名不能触发「按 App 记忆」：那个模式没开。
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
        if let (Some(app), Some(chosen)) = (app_name.as_deref(), request.target_override.as_deref())
        {
            if settings.app_target_langs.get(app).map(String::as_str) != Some(chosen) {
                // 在锁里对**最新**设置打补丁，而不是把请求开始时的快照整份写回：
                // 中间隔着 Keychain、预算和 AX 查询，这段时间里用户在设置窗改的东西会被冲掉。
                let mut current = state.settings.lock().expect("设置锁不应中毒");
                let mut updated = current.clone();
                // 存不下也不影响这次翻译，只是下次还得再选一次。
                if updated.remember_app_target(app, chosen)
                    && updated.save(&state.config_dir).is_ok()
                {
                    *current = updated;
                }
            }
        }
    }
    let target_name = lang::display_name(&target_code);
    let source_name = source.map(lang::display_name);

    // 术语表（PRD §5.8）：按语言对筛选、只取命中的术语、跨表去重后渲染成一段。
    // 没有任何命中时是 None，`{glossary}` 段也就不会出现在 Prompt 里。
    let glossary_block = {
        let store = state.glossaries.lock().expect("术语表锁不应中毒");
        crate::glossaries::Glossaries::block_for(&store.lists, source, &target_code, text)
    };

    let vars = prompt::PromptVars {
        source_lang: source_name.as_deref(),
        target_lang: &target_name,
        glossary: glossary_block.as_deref(),
        // 读到了就交给 Prompt：既渲染指令里的 `{app_name}`，也作为语气提示（PRD §5.7）。
        app_name: app_name.as_deref(),
    };

    // 单选一个词（≤3 个词）时走词卡（PRD §5.2），其余的走普通翻译。
    // 判定与 Prompt 都来自核心层的同一份实现，客户端不重复写一遍。
    let word_mode = umuo_core::word_card::is_word_mode(text);
    let chat = if word_mode {
        umuo_core::word_card::build_request(text, &vars)
    } else {
        prompt::build_translation_request(&style, &vars, text)
    };

    let primary = ModelRef {
        provider_id: provider.id.to_string(),
        model: model.clone(),
    };
    // 分场景模型 + 用户的备用顺序（PRD §6.3）。两者都允许指向**另一家供应商**，
    // 所以下面的循环必须按候选逐个解析供应商与 Key。
    let mut plan = router::build_plan(
        mode.scene(),
        Some(&primary),
        &settings.scene_models,
        &settings.fallback_models,
    );

    let start = StartPayload {
        text: text.to_string(),
        provider: provider.label.to_string(),
        model: model.clone(),
        target_lang: target_name.clone(),
        word_mode,
        mode: mode.as_str(),
    };
    send(deps.sink, route, start.clone());

    // ---------------------------------------------------------------
    // PRD §6.3：超过模型上下文 70%，或译文装不进一次请求的输出上限时，
    // 按段落切分**并发**请求，结果按顺序合并。
    //
    // 词卡模式永不切分：它处理的本来就是 ≤3 个词。
    //
    // 故障转移按**整批**做，与单请求路径同一套规则：首选整批失败（限流、5xx、
    // 模型不可用……）就换下一个候选把全部分片重发一遍；没配 Key、端点没填的候选
    // 跳过；网络断了先插入本机候选。不做逐片重试——按片重放并对齐顺序复杂度上一个台阶，
    // 而整批重发只多花一次已失败那批的钱。
    // 输出上限把切分门槛压到了几千字（审查 M4），中等长度的文本也走这里，
    // 所以这条路径不能比单请求路径少了故障转移。
    // ---------------------------------------------------------------
    let context_tokens = provider::context_window_for(&model);
    if !word_mode && chunk::needs_splitting(text, context_tokens) {
        let cjk_ratio = chunk::cjk_ratio(text);
        let options = StreamOptions {
            timeout: plan.timeout,
            cancel: Some(&ticket.cancel),
        };
        let mut sink = |delta: &str| {
            send(
                deps.sink,
                route,
                DeltaPayload {
                    text: delta.to_string(),
                },
            );
        };
        let mut last_error: Option<CoreError> = None;
        let mut offline_attempted = false;
        let mut local_at: Option<usize> = None;
        // 已经真正发出过一个候选（跳过的不算）：之后每次换候选都要先让前端清空。
        let mut tried = false;
        let mut index = 0;
        // 实际出结果的那一次：供应商、模型、是否本机兜底。
        let mut succeeded = None;
        while index < plan.candidates.len() {
            let candidate = plan.candidates[index].clone();
            let attempt = index;
            index += 1;
            // 与单请求循环同样的跳过规则：每个候选各自解析供应商、Key 与地址。
            let Some(candidate_provider) = provider::find_provider(&candidate.provider_id) else {
                continue;
            };
            let Some(candidate_key) = usable_key(
                candidate_provider,
                deps.core.host.api_key(candidate_provider.id).ok().flatten(),
            ) else {
                continue;
            };
            let candidate_base_url = match settings.base_url_override(candidate_provider) {
                Ok(url) => url,
                Err(error) => {
                    last_error = Some(error);
                    continue;
                }
            };

            // 按**这个候选**的上下文窗口切：备用模型的窗口可能比首选小。
            let budget =
                chunk::char_budget(provider::context_window_for(&candidate.model), cjk_ratio);
            // 每片各建一个请求体：`{text}` 变量不同，system 与风格保持一致。
            // 分隔符随片一起带上，合并译文时还原原文的段间空行。
            let pieces = chunk::split(text, budget);
            let requests: Vec<_> = pieces
                .iter()
                .map(|piece| prompt::build_translation_request(&style, &vars, &piece.text))
                .collect();
            let separators: Vec<String> = pieces.into_iter().map(|piece| piece.separator).collect();

            // 换候选重发之前先让前端清空：上一个候选已经流出去的分片还挂在浮窗里，
            // 而前端的 delta 只做追加——不清掉就是「旧的前几片 + 新的全文」（审查）。
            // 复用 start：同一个请求 id 的 start 会整体重置译文、保持 streaming。
            if tried {
                emit_restart(
                    deps.sink,
                    route,
                    &start,
                    candidate_provider,
                    &candidate.model,
                );
            }
            tried = true;

            match run_chunks(
                &state.client,
                candidate_provider,
                candidate_base_url.as_deref(),
                &candidate.model,
                &candidate_key,
                &requests,
                &separators,
                &options,
                &mut sink,
            )
            .await
            {
                Ok(outcome) => {
                    succeeded = Some((
                        outcome,
                        candidate_provider,
                        candidate.model,
                        local_at == Some(attempt),
                    ));
                    break;
                }
                Err(error) => {
                    // 长文本同样要能离线回落，否则「短句离线能用、长段离线不能用」。
                    if !offline_attempted && should_fall_back_to_local(&error) {
                        offline_attempted = true;
                        if let Some(local) = local_candidate(&state.client, &settings).await {
                            plan.candidates.insert(index, local);
                            local_at = Some(index);
                            continue;
                        }
                    }
                    if router::next_after_failure(&plan, attempt, &error).is_some() {
                        last_error = Some(error);
                        continue;
                    }
                    return Err(error);
                }
            }
        }
        let Some((outcome, used_provider, used_model, offline)) = succeeded else {
            return Err(last_error.unwrap_or(CoreError::MissingKey));
        };

        // 收尾与单请求路径同构（记账 → 写回 → 落库 → done）。
        // 两处刻意保持形似：分片路径不处理词卡，所以少了卡片那一段。
        // 记账排在写回**之前**：厂商已经按整段计费，写回失败（用户中途切了窗口）
        // 也不能让这笔钱从月度上限里消失。
        let cost_usd = chunk_cost_usd(used_provider.id, &used_model, outcome.usage);
        crate::history::record_usage(
            deps.core,
            used_provider.id,
            &used_model,
            outcome.usage,
            cost_usd,
        );
        let replaced = match request.focus_source {
            Some(source) if mode.write_back() => {
                // 半截译文不能替换原文（审查 M4）。
                if outcome.truncated {
                    return Err(CoreError::Truncated);
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

        // 截断的不进历史：历史里的译文会被当成完整结果复制、再利用。
        if !outcome.truncated {
            crate::history::record(
                deps.core,
                crate::history::Draft {
                    source_text: text.to_string(),
                    translated_text: outcome.text.clone(),
                    source_lang: source.map(str::to_string),
                    target_lang: target_name.clone(),
                    provider_id: used_provider.id.to_string(),
                    model: used_model.clone(),
                    style_id: settings.style_id.clone(),
                    scene: mode.as_str().to_string(),
                    input_tokens: outcome.usage.input_tokens,
                    output_tokens: outcome.usage.output_tokens,
                    estimated: outcome.usage.estimated,
                    cost_usd,
                },
            );
        }

        emit_done(
            deps.sink,
            route,
            &used_model,
            &outcome,
            DoneFacts {
                replaced,
                offline,
                cost_usd,
                warning: done_warning(budget_warning.as_deref(), outcome.truncated),
            },
        );
        return Ok(());
    }

    let mut last_error: Option<CoreError> = None;
    // PRD §7.5：网络不通时改用本机模型，并标注「离线」。**只试一次**——
    // 本机也没有可用模型时不该反复探测。
    let mut offline_attempted = false;
    // 本机候选插在计划里的位置。成功的那次正是它，才标「离线」（审查 L2）。
    let mut local_at: Option<usize> = None;
    // 与分片路径相同：流到一半失败再转移时，前一个候选的半段译文要先清掉。
    let mut tried = false;
    // 索引式而不是 `for ... in iter()`：离线回落要把本机候选**插**进计划，
    // 迭代中改 `plan.candidates` 借用检查过不去。
    let mut index = 0;
    while index < plan.candidates.len() {
        let candidate = plan.candidates[index].clone();
        let attempt = index;
        index += 1;
        // 每个候选各自解析供应商、Key 与地址。
        //
        // **不能沿用循环外那套。** 分场景模型与备用顺序都可能指向另一家供应商，
        // 而 `ModelRef` 里带着 `provider_id`；沿用首选供应商会把 A 家的模型名
        // 发到 B 家的端点，得到一个「模型不存在」的 404——用户完全不知道为什么。
        let Some(candidate_provider) = provider::find_provider(&candidate.provider_id) else {
            continue;
        };
        // 没配 Key 的候选直接跳过：拿空 Key 去请求只会得到 401，
        // 而它并不是「这次翻译失败」的真正原因。本机供应商不需要 Key，照常发请求。
        let Some(candidate_key) = usable_key(
            candidate_provider,
            deps.core.host.api_key(candidate_provider.id).ok().flatten(),
        ) else {
            continue;
        };
        // 自定义端点没填地址时要跳过这个候选，而不是把空地址发出去。
        let candidate_base_url = match settings.base_url_override(candidate_provider) {
            Ok(url) => url,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };

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

        if tried {
            emit_restart(
                deps.sink,
                route,
                &start,
                candidate_provider,
                &candidate.model,
            );
        }
        tried = true;

        let outcome = transport::stream_chat(
            &state.client,
            &ChatTarget {
                provider: candidate_provider,
                base_url: candidate_base_url.as_deref(),
                model: &candidate.model,
                api_key: &candidate_key,
                chat: &chat,
            },
            &StreamOptions {
                timeout: plan.timeout,
                cancel: Some(&ticket.cancel),
            },
            &mut sink,
        )
        .await;

        match outcome {
            Ok(outcome) => {
                // 先记账：厂商一返回成功就已经计费。下面的写回可能失败
                // （用户等待时切了应用或焦点），那时函数提前返回 Err、不记历史，
                // 但这笔钱必须照样进账本，否则月度上限会少算。
                let price = usage::builtin_price(candidate_provider.id, &candidate.model);
                let cost_usd = price.map(|p| usage::cost_usd(outcome.usage, p));
                crate::history::record_usage(
                    deps.core,
                    candidate_provider.id,
                    &candidate.model,
                    outcome.usage,
                    cost_usd,
                );

                // 静默翻译在这里把结果写回原处。**只在这一个分支里写回**——
                // 上面的任何失败路径都不会碰用户的内容，这是 §5.4 「失败时不修改原文」
                // 的落点：不是靠 try/finally，而是靠「只有成功才走到这里」。
                let replaced = match request.focus_source {
                    Some(source) if mode.write_back() => {
                        // 半截译文不能替换原文（审查 M4）。
                        if outcome.truncated {
                            return Err(CoreError::Truncated);
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
                                    forms: card.forms.clone(),
                                    examples: card
                                        .examples
                                        .iter()
                                        .map(|example| CardExample {
                                            source: example.source.clone(),
                                            target: example.target.clone(),
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

                // 记历史。放在 emit 之前：浮窗显示与落库是同一次成功的两个后果，
                // 而落库失败只打日志、不影响用户看到译文。
                // 截断的不进历史：历史里的译文会被当成完整结果复制、再利用。
                if !outcome.truncated {
                    crate::history::record(
                        deps.core,
                        crate::history::Draft {
                            source_text: text.to_string(),
                            translated_text: history_text,
                            source_lang: source.map(str::to_string),
                            target_lang: target_name.clone(),
                            provider_id: candidate_provider.id.to_string(),
                            model: candidate.model.clone(),
                            style_id: settings.style_id.clone(),
                            scene: mode.as_str().to_string(),
                            input_tokens: outcome.usage.input_tokens,
                            output_tokens: outcome.usage.output_tokens,
                            estimated: outcome.usage.estimated,
                            cost_usd,
                        },
                    );
                }

                emit_done(
                    deps.sink,
                    route,
                    &candidate.model,
                    &outcome,
                    DoneFacts {
                        replaced,
                        offline: local_at == Some(attempt),
                        cost_usd,
                        warning: done_warning(budget_warning.as_deref(), outcome.truncated),
                    },
                );
                return Ok(());
            }
            Err(error) => {
                // PRD §7.5：网络断了的话，若本机有可用模型就改用它。
                // 排在路由故障转移**之前**：本地模型比「换个云端模型」更可能管用，
                // 而且后者在网络不通时同样会失败。
                if !offline_attempted && should_fall_back_to_local(&error) {
                    offline_attempted = true;
                    if let Some(local) = local_candidate(&state.client, &settings).await {
                        // 插在**下一个**位置而不是追加到末尾（审查 L2）：网络断了，
                        // 剩下的云端备用多半同样失败，先试本机。
                        plan.candidates.insert(index, local);
                        local_at = Some(index);
                        continue;
                    }
                }
                // 路由层决定这次失败值不值得换个模型再试（PRD §6.3）。
                if router::next_after_failure(&plan, attempt, &error).is_some() {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
        }
    }

    // 走到这里说明每个候选都失败了，或者全被跳过了（没配 Key、自定义端点没填地址）。
    // `NoEngine` 在两种情况下都不准确：用户明明配了引擎，只是这次没用上。
    Err(last_error.unwrap_or(CoreError::MissingKey))
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

fn emit_done(
    sink: &dyn TranslateSink,
    route: Route,
    model: &str,
    outcome: &transport::StreamOutcome,
    facts: DoneFacts,
) {
    send(
        sink,
        route,
        DonePayload {
            model: model.to_string(),
            input_tokens: outcome.usage.input_tokens,
            output_tokens: outcome.usage.output_tokens,
            estimated: outcome.usage.estimated,
            cost_usd: facts.cost_usd,
            first_token_ms: outcome.first_token_ms,
            total_ms: outcome.total_ms,
            replaced: facts.replaced,
            offline: facts.offline,
            warning: facts.warning,
        },
    );
}

/// 收尾要用的几个事实。
///
/// 打成一个结构体而不是四个散参数：它们一起产生、一起被消费，
/// 拆开后调用点会变成一串看不出含义的布尔与 Option（`true, false, None, ...`）。
struct DoneFacts {
    replaced: bool,
    offline: bool,
    cost_usd: Option<f64>,
    /// 月度上限的提醒（超限了、换人了）。`None` = 无事发生。
    warning: Option<String>,
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
    use std::sync::atomic::Ordering;

    use super::*;

    struct NoHost;

    impl Host for NoHost {
        fn api_key(&self, _: &str) -> Result<Option<String>, String> {
            Ok(None)
        }
        fn frontmost_app_name(&self) -> Option<String> {
            None
        }
        fn frontmost_app_token(&self) -> Option<String> {
            None
        }
        fn write_back(&self, _: FocusSource, _: &str, _: &str) -> Result<(), String> {
            unreachable!("这些测试不跑流水线")
        }
    }

    struct NoSink;

    impl TranslateSink for NoSink {
        fn send(&self, _: Route, _: TranslateEvent) {}
    }

    fn core() -> Arc<AppCore> {
        let dir = std::env::temp_dir().join(format!("umuo-app-translate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Arc::new(AppCore::open(dir, Arc::new(NoHost)).unwrap())
    }

    #[test]
    fn events_go_to_the_window_the_mode_belongs_to() {
        // 窗口标签是外壳与前端共用的契约：外壳的 PANEL_LABEL / COMPOSE_LABEL 就是它们的别名。
        assert_eq!(PANEL_SURFACE, "panel");
        assert_eq!(COMPOSE_SURFACE, "compose");
        for mode in [Mode::Selection, Mode::SilentReplace, Mode::Ocr] {
            assert_eq!(mode.surface(), PANEL_SURFACE);
        }
        assert_eq!(Mode::Compose.surface(), COMPOSE_SURFACE);
    }

    #[test]
    fn starting_a_translation_supersedes_the_previous_one_on_the_same_window_right_away() {
        // 登记是同步的：返回的 future 还没被运行时排上，旧请求就已经被顶掉。
        let core = core();
        let old = core.requests.begin(PANEL_SURFACE);
        let compose = core.requests.begin(COMPOSE_SURFACE);

        let run = core.start_translation(Request::selection("hello"), None, Arc::new(NoSink));

        assert!(old.cancel.load(Ordering::Relaxed), "同一窗口的旧请求被取消");
        assert!(!compose.cancel.load(Ordering::Relaxed), "别的窗口不受影响");
        drop(run);
    }
}
