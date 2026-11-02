//! 传输层：把 [`WireRequest`] 发出去，把字节流变成 [`StreamEvent`]。
//!
//! 这一层刻意很薄——所有能脱离网络测试的逻辑都已经挪走了：
//! 请求构造与事件解析在 [`crate::wire`]，错误分类在 [`crate::error`]。
//! 留在这里的只有「发请求、读字节、按事件分发」。
//!
//! **超时的语义**（容易被误读，写清楚）：`timeout` 只约束「拿到响应头」这一段，
//! 也就是首字延迟。流一开始流动，改由 [`STREAM_IDLE_TIMEOUT`] 约束「两个分片之间」
//! 的间隔。理由：PRD §3.2 把首字延迟定成了核心指标，但一段三千字的译文流式输出
//! 本来就需要几十秒——用首个超时去卡整条流，会让所有长文本被误判为超时。

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use futures_util::StreamExt;

use crate::error::{classify_http_error, redact_secrets, CoreError};
use crate::provider::{Protocol, Provider};
use crate::wire::{
    build_chat_request_at, parse_stream_event, ChatRequest, SseDecoder, StreamEvent, TokenUsage,
    WireRequest,
};

/// 等首个响应头的超时（PRD §6.3 默认 8 s）。只约束首字延迟，流式读取另有空闲超时。
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(8);

/// 流中途允许的最大静默时间。超过它说明连接已经死了，继续等下去只会让用户干瞪眼。
pub const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/// 读错误体的上限（审查 L9）。错误体只用来分类，服务端拖着不发完时宁可按空体分类。
const ERROR_BODY_TIMEOUT: Duration = Duration::from_secs(10);

/// 等待期间多久看一次取消标志。取消是 `AtomicBool`，没有通知可等，只能轮询；
/// 100 ms 对「按 Esc 立刻停」足够，开销可以忽略。
const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// 分片路径同时在途的请求数上限（审查：切分门槛降到几千字后，长文动辄几十片，
/// 全部同时发出会撞上厂商的 RPM/TPM 限流，限流又触发整批故障转移，下一个候选
/// 照样被打满）。4 路并发已经能把总耗时压到串行的几分之一。
pub const MAX_CONCURRENT_CHUNKS: usize = 4;

/// 重定向最多跟几跳。自定义策略会顶掉 reqwest 默认的 10 跳上限，这里补回来。
const MAX_REDIRECTS: usize = 10;

/// 构造 HTTP 客户端。
///
/// 刻意不带任何遥测 / 追踪头：BYOK 模式下请求是用户与供应商之间的事，
/// 我们连自己的标识都不该加进去。
pub fn build_client() -> Result<reqwest::Client, CoreError> {
    build_client_with(&crate::proxy::ProxyChoice::System)
}

/// 按代理意图构建客户端（PRD §8）。
///
/// 三种意图的来源不同，所以必须**显式**落下去：
/// - [`ProxyChoice::System`]：什么都不设，交给 reqwest 读系统代理（macOS 上由
///   `system-proxy` feature 提供）；
/// - [`ProxyChoice::Direct`]：`no_proxy()`——注意它连系统代理也一起忽略，
///   这才是"直连"应有的语义（否则公司网络里根本绕不开那个代理）；
/// - [`ProxyChoice::Custom`]：`Proxy::all`，http/https/socks5 都走同一条。
pub fn build_client_with(choice: &crate::proxy::ProxyChoice) -> Result<reqwest::Client, CoreError> {
    let mut builder =
        reqwest::Client::builder().user_agent(concat!("umuo/", env!("CARGO_PKG_VERSION")));

    match choice {
        crate::proxy::ProxyChoice::System => {}
        crate::proxy::ProxyChoice::Direct => builder = builder.no_proxy(),
        crate::proxy::ProxyChoice::Custom(url) => {
            let proxy = reqwest::Proxy::all(url).map_err(|e| CoreError::Network {
                // reqwest 的错误原文可能带着代理地址（含 `user:pass@`），进界面与日志前脱敏。
                message: format!("代理地址不可用：{}", redact_secrets(&e.to_string())),
            })?;
            builder = builder.proxy(proxy);
        }
    }

    // 跨源重定向不跟（审查 L34）：reqwest 跨主机时只会剥掉 `Authorization`，
    // `x-api-key` / `x-goog-api-key` / `api-key` 照样转发，Key 会被送到别的主机。
    // 不用 `Policy::none()`：自定义端点常见同主机的补斜杠跳转，那种得照常跟。
    // 停下来时拿到的是 3xx 响应本身，按 HTTP 错误报出来。
    builder = builder.redirect(reqwest::redirect::Policy::custom(|attempt| {
        let allowed = attempt.previous().len() <= MAX_REDIRECTS
            && attempt
                .previous()
                .last()
                .is_some_and(|from| redirect_allowed(from, attempt.url()));
        if allowed {
            attempt.follow()
        } else {
            attempt.stop()
        }
    }));

    builder.build().map_err(|e| CoreError::Network {
        message: redact_secrets(&e.to_string()),
    })
}

/// 重定向只在同源（协议、主机、端口都相同）时跟随。https 降到 http 也算换了源。
fn redirect_allowed(from: &reqwest::Url, to: &reqwest::Url) -> bool {
    from.scheme() == to.scheme()
        && from.host_str() == to.host_str()
        && from.port_or_known_default() == to.port_or_known_default()
}

/// 一次流式翻译的结果。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StreamOutcome {
    pub text: String,
    pub usage: TokenUsage,
    /// 首字延迟（毫秒）。PRD §3.2 的 P50 ≤ 800 ms 指的就是它。
    pub first_token_ms: Option<u64>,
    pub total_ms: u64,
    /// 译文没说完（审查 M4）：厂商报告触到输出上限，或连接在终止信号之前就断了。
    /// 文本照常返回给界面看，但不能当作完整译文写回原文。
    pub truncated: bool,
    /// 收到过厂商的停止原因。Gemini 没有结束哨兵，靠它区分「说完了」与「断了」。
    stopped: bool,
}

/// 分片并发翻译（PRD §6.3）：并发跑多个请求，按原文顺序输出增量。
///
/// 三个要点：
///
/// 1. **有上限的并发**：最多 [`MAX_CONCURRENT_CHUNKS`] 片同时在途，一片完成再补发下一片。
///    长文本用串行会让用户等成倍的时间，全部同时发又会把自己限流。
/// 2. **按序输出**：完成顺序不确定，所以未轮到的分片先存下来，
///    只吐「从游标开始连续就绪」的那一段（见 [`crate::chunk::drain_in_order`]）。
/// 3. **用量汇总**：多片各算各的 token，最后相加——按片的 usage 直接取一片会漏账。
///
/// 分片数量由调用方按 [`crate::chunk::split`] 决定，这里不重复算预算。
/// `separators` 与 `requests` 一一对应，是各片在原文里的前导分隔符
/// （[`crate::chunk::TextChunk::separator`]），合并译文时照原样补回。
pub async fn stream_chunks(
    client: &reqwest::Client,
    target: &ChunkTarget<'_>,
    requests: &[ChatRequest],
    separators: &[String],
    options: &StreamOptions<'_>,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> Result<StreamOutcome, CoreError> {
    use futures_util::stream::{self, StreamExt};

    let started = std::time::Instant::now();
    let mut pending: Vec<Option<String>> = vec![None; requests.len()];
    // 已经按序吐出去的片段。单独收集而不是回头从 `pending` 拼——
    // 见函数末尾的注释。
    let mut merged: Vec<String> = Vec::with_capacity(requests.len());
    let mut cursor = 0usize;
    let mut usage = TokenUsage::default();
    let mut first_token_ms: Option<u64> = None;
    let mut truncated = false;
    // 先把每片的 future 建好（async 块不被 poll 就不会发请求），再交给
    // `buffer_unordered`：它按顺序启动、按完成顺序产出，同时在途的不超过上限；
    // 出错提前返回或取消时，还没启动的分片根本不会发出去。
    // 不在 `stream::iter(..).map(闭包)` 里建：那种写法的闭包带着借用的生命周期，
    // 外层 future 被 `tokio::spawn` 时会报「FnOnce is not general enough」。
    let mut futures = Vec::with_capacity(requests.len());
    for (index, request) in requests.iter().enumerate() {
        let chunk_target = ChatTarget {
            provider: target.provider,
            base_url: target.base_url,
            model: target.model,
            api_key: target.api_key,
            chat: request,
        };
        futures.push(async move {
            let mut buffer = String::new();
            let outcome = {
                let mut sink = |delta: &str| buffer.push_str(delta);
                stream_chat(client, &chunk_target, options, &mut sink).await
            };
            (index, buffer, outcome)
        });
    }
    let mut inflight = stream::iter(futures).buffer_unordered(MAX_CONCURRENT_CHUNKS);

    let count = requests.len();
    let mut completed = 0usize;
    while let Some((index, buffer, outcome)) = inflight.next().await {
        let outcome = outcome?;
        usage.input_tokens += outcome.usage.input_tokens;
        usage.output_tokens += outcome.usage.output_tokens;
        // 估算是「或」的关系：只要有一片是估的，整体就不能声称精确。
        usage.estimated |= outcome.usage.estimated;
        // 截断同理：任何一片没说完，合并后的全文就不完整。
        truncated |= outcome.truncated;
        if first_token_ms.is_none() {
            first_token_ms = outcome.first_token_ms;
        }

        // 用**流出来的文本**而不是 outcome.text：两者应当一致，
        // 但如果传输层将来改了拼接方式，这里以用户实际看到的为准。
        pending[index] = Some(buffer);
        completed += 1;

        // `cursor` 在 drain 里会被推进，所以先把「本轮之前已输出几片」记下来——
        // 补分隔符用的是**全文序号**，不是批内序号（见 chunk::with_separators）。
        let already_out = cursor;
        let ready = crate::chunk::drain_in_order(&mut pending, &mut cursor);
        for text in crate::chunk::with_separators(already_out, separators, ready) {
            merged.push(text.clone());
            on_delta(&text);
        }
    }

    debug_assert_eq!(completed, count, "每个分片都应当有结果或提前返回错误");

    Ok(StreamOutcome {
        // 必须用单独收集的 `merged`：`drain_in_order` 是 `take()` 走的，
        // 循环结束后 `pending` 已经全空，从它拼会得到空串。
        text: merged.join(""),
        usage,
        first_token_ms,
        total_ms: started.elapsed().as_millis() as u64,
        truncated,
        stopped: true,
    })
}

/// 分片请求**共用**的目标信息：发给谁、用哪个模型、拿哪把 Key。
///
/// 为什么不让它复用 [`ChatTarget`]：那个结构体还带着一个具体的请求体，
/// 而分片路径下每片各有各的请求体（由 `requests` 提供），
/// 传一个用不到的 `chat` 进去只会让人以为它有用。
#[derive(Debug, Clone, Copy)]
pub struct ChunkTarget<'a> {
    pub provider: &'a Provider,
    pub base_url: Option<&'a str>,
    pub model: &'a str,
    pub api_key: &'a str,
}

/// 一次翻译的目标：发给谁、用哪个模型、拿哪把 Key、发什么内容。
///
/// 打成一个结构体而不是四个散参数，是为了让调用点自解释——
/// `stream_chat(&client, &target, &options, sink)` 比一长串位置参数难写错得多。
pub struct ChatTarget<'a> {
    pub provider: &'a Provider,
    /// Base URL 覆盖。`None` = 用目录里的地址；自定义端点填用户给的那个。
    pub base_url: Option<&'a str>,
    pub model: &'a str,
    pub api_key: &'a str,
    pub chat: &'a ChatRequest,
}

/// 一次流式请求的可调参数。
pub struct StreamOptions<'a> {
    /// 只约束「拿到响应头」这一段，即首字延迟。
    pub timeout: Duration,
    /// 轮询式取消标志；用户按 Esc 时置位。
    pub cancel: Option<&'a AtomicBool>,
}

impl Default for StreamOptions<'_> {
    fn default() -> Self {
        Self {
            timeout: DEFAULT_TIMEOUT,
            cancel: None,
        }
    }
}

/// 发一次流式对话请求。
///
/// `on_delta` 每收到一段增量就被调用一次——UI 靠它做逐字渲染。
/// `cancel` 是一个轮询标志：长文本翻译时用户按 Esc 要能立刻停下，而不是等完整条流。
///
/// 回调刻意要求 `Send`：调用方几乎总是把它丢进 `tokio::spawn`（Tauri 命令就是这么做的），
/// 而一个非 `Send` 的回调会让整个 future 变成非 `Send`，报错却指向几十层之外的 spawn。
/// 在这里钉住这个约束，比在调用方绕过它要诚实得多。
pub async fn stream_chat(
    client: &reqwest::Client,
    target: &ChatTarget<'_>,
    options: &StreamOptions<'_>,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> Result<StreamOutcome, CoreError> {
    let ChatTarget {
        provider,
        base_url,
        model,
        api_key,
        chat,
    } = *target;
    let wire = build_chat_request_at(
        provider,
        base_url.unwrap_or(provider.base_url),
        model,
        api_key,
        chat,
        true,
    )?;
    let started = Instant::now();

    // 等响应头的这段也要能取消：推理模型的首字可能要等几十秒。
    let response = cancellable(options.cancel, send(client, &wire, options.timeout)).await??;

    let status = response.status();
    if !status.is_success() {
        let retry_after = parse_retry_after(response.headers());
        // 错误体可能很长，但分类需要完整文本；截断只发生在进入 UI 之前。
        let body = read_error_body(response).await;
        return Err(classify_http_error(status.as_u16(), &body, retry_after));
    }

    let protocol = provider.protocol;
    let mut decoder = SseDecoder::new();
    let mut stream = response.bytes_stream();
    let mut outcome = StreamOutcome::default();

    // 收到了结束哨兵（`[DONE]` / `message_stop`）。
    let mut sentinel = false;
    loop {
        // 取消与读取一起竞争（审查 L9）：只在分片之间看标志的话，
        // 模型静默思考时按 Esc 要等到下一个分片、最长等满空闲超时。
        let next = cancellable(
            options.cancel,
            tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.next()),
        )
        .await?;
        let bytes = match next {
            Err(_) => {
                return Err(CoreError::Timeout {
                    after: STREAM_IDLE_TIMEOUT,
                })
            }
            Ok(None) => break,
            Ok(Some(Err(e))) => {
                return Err(CoreError::Network {
                    message: redact_secrets(&e.to_string()),
                })
            }
            Ok(Some(Ok(bytes))) => bytes,
        };

        let mut finished = false;
        for payload in decoder.push(&bytes) {
            if apply(protocol, &payload, &mut outcome, started, on_delta)? {
                finished = true;
            }
        }
        if finished {
            sentinel = true;
            break;
        }
    }

    // 流尾可能残留一个没有以空行收尾的事件；不处理它会丢掉最后一段译文。
    // 结束哨兵也可能就是这条残留事件，同样要算数，否则完整的流会被误判成截断。
    for payload in decoder.finish() {
        if apply(protocol, &payload, &mut outcome, started, on_delta)? {
            sentinel = true;
        }
    }

    outcome.total_ms = started.elapsed().as_millis() as u64;
    // 既没有结束哨兵、也没有停止原因就 EOF 了：连接半路断开，译文多半不全。
    if !sentinel && !outcome.stopped {
        outcome.truncated = true;
    }

    if outcome.text.is_empty() {
        // 200 + 空内容是最容易被误解的失败形态：界面上会显示成「翻译成功但没有结果」。
        return Err(CoreError::BadResponse {
            detail: "流式响应没有产生任何内容".to_string(),
        });
    }
    // 厂商没回用量（或只回了一半）时本地估算并标成估算值——
    // 否则这次翻译会以 0 token、$0 的「精确值」进历史与账本，月度上限跟着失明。
    outcome.usage = crate::usage::fill_missing_usage(
        outcome.usage,
        &format!("{}\n{}", chat.system, chat.user),
        &outcome.text,
    );
    Ok(outcome)
}

/// 把一条 SSE payload 应用到累积结果上。返回 `Ok(true)` 表示流已正常结束。
///
/// 抽成独立函数是为了能在没有网络的情况下测——这是本文件里唯一有分支的逻辑。
fn apply(
    protocol: Protocol,
    payload: &str,
    outcome: &mut StreamOutcome,
    started: Instant,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> Result<bool, CoreError> {
    let mut finished = false;
    // 同一个 payload 可能同时带文本与用量（Gemini、DeepSeek 末块），两个都要吃进来。
    for event in parse_stream_event(protocol, payload) {
        match event {
            StreamEvent::Delta(delta) => {
                if outcome.first_token_ms.is_none() {
                    outcome.first_token_ms = Some(started.elapsed().as_millis() as u64);
                }
                outcome.text.push_str(&delta);
                on_delta(&delta);
            }
            StreamEvent::Usage(usage) => {
                // 用量可能分多次到达（Anthropic 的 message_start 给输入、message_delta 给输出），
                // 所以按字段取较大值合并，而不是整块覆盖。
                outcome.usage.input_tokens = outcome.usage.input_tokens.max(usage.input_tokens);
                outcome.usage.output_tokens = outcome.usage.output_tokens.max(usage.output_tokens);
                if !usage.estimated {
                    outcome.usage.estimated = false;
                }
            }
            StreamEvent::Finished { truncated } => {
                outcome.stopped = true;
                outcome.truncated |= truncated;
            }
            StreamEvent::Error(error) => return Err(error),
            StreamEvent::Done => finished = true,
        }
    }
    Ok(finished)
}

/// 发一次非流式请求并取回文本（模型列表、Key 校验用）。
pub async fn fetch_json(
    client: &reqwest::Client,
    wire: &WireRequest,
    timeout: Duration,
) -> Result<String, CoreError> {
    let response = send(client, wire, timeout).await?;
    let status = response.status();
    if !status.is_success() {
        let body = read_error_body(response).await;
        return Err(classify_http_error(status.as_u16(), &body, None));
    }
    // 正文也受同一个超时约束：拿到响应头之后服务端仍可能拖着不发完。
    let body = match tokio::time::timeout(timeout, response.text()).await {
        Err(_) => return Err(CoreError::Timeout { after: timeout }),
        Ok(Err(e)) => {
            return Err(CoreError::Network {
                message: redact_secrets(&e.to_string()),
            })
        }
        Ok(Ok(body)) => body,
    };
    Ok(body)
}

async fn send(
    client: &reqwest::Client,
    wire: &WireRequest,
    timeout: Duration,
) -> Result<reqwest::Response, CoreError> {
    let mut builder = match wire.method {
        "POST" => client.post(&wire.url),
        _ => client.get(&wire.url),
    };
    for (name, value) in &wire.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(body) = &wire.body {
        builder = builder.body(body.clone());
    }

    match tokio::time::timeout(timeout, builder.send()).await {
        // 超时归 Timeout（可重试、可转移），而不是 Network：两者给用户的动作不同。
        Err(_) => Err(CoreError::Timeout { after: timeout }),
        // reqwest 的错误原文带着请求 URL：自定义端点可能写了 user:pass@，进界面前脱敏。
        Ok(Err(e)) => Err(CoreError::Network {
            message: redact_secrets(&e.to_string()),
        }),
        Ok(Ok(response)) => Ok(response),
    }
}

/// 解析 `Retry-After`。只认秒数形式；HTTP-date 形式返回 `None`，
/// 让上层用自己的退避曲线（解析日期容易出错，收益也小）。
fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

/// 读错误体，最多等 [`ERROR_BODY_TIMEOUT`]；超时或读失败都按空体处理。
async fn read_error_body(response: reqwest::Response) -> String {
    tokio::time::timeout(ERROR_BODY_TIMEOUT, response.text())
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
}

/// 让一个等待与取消标志竞争：标志先置位就返回 [`CoreError::Cancelled`]。
async fn cancellable<T>(
    cancel: Option<&AtomicBool>,
    work: impl std::future::Future<Output = T>,
) -> Result<T, CoreError> {
    let Some(flag) = cancel else {
        return Ok(work.await);
    };
    tokio::select! {
        // 先看取消：两边同时就绪时不该再处理一个用户已经不要的分片。
        biased;
        _ = wait_cancelled(flag) => Err(CoreError::Cancelled),
        value = work => Ok(value),
    }
}

/// 轮询取消标志，置位后返回。
async fn wait_cancelled(flag: &AtomicBool) {
    while !flag.load(Ordering::Relaxed) {
        tokio::time::sleep(CANCEL_POLL_INTERVAL).await;
    }
}

#[cfg(test)]
mod proxy_client_tests {
    use super::*;
    use crate::proxy::ProxyChoice;

    #[test]
    fn every_intent_yields_a_usable_client() {
        // 构建客户端不需要联网，所以这三种都能在这里验。
        for choice in [
            ProxyChoice::System,
            ProxyChoice::Direct,
            ProxyChoice::Custom("socks5://127.0.0.1:1080".to_string()),
            ProxyChoice::Custom("http://proxy.example:8080".to_string()),
        ] {
            assert!(
                build_client_with(&choice).is_ok(),
                "{choice:?} 应当能建出客户端"
            );
        }
    }

    #[test]
    fn the_builder_is_half_lenient_which_is_why_the_settings_layer_checks_first() {
        // **实测结论**（这两种行为都是跑出来的，不是猜的）：
        //
        // - `"127.0.0.1:1080"`（最常见的填错法：少了协议头）→ **被接受**，
        //   reqwest 当成默认协议处理。于是请求会走一个用户没预期的代理，
        //   表现是超时而不是报错——最难查的那种。
        // - 空白字符 → **被拒绝**。
        //
        // 所以"地址填错了"不能指望构建层拦。这就是 `proxy::parse_proxy`
        // 存在的理由，也是设置保存时要校验的理由。
        for accepted in ["127.0.0.1:1080", "这不是地址"] {
            assert!(
                build_client_with(&ProxyChoice::Custom(accepted.to_string())).is_ok(),
                "构建层会接受「{accepted}」——这是设置层必须自己校验的原因"
            );
        }
        assert!(
            build_client_with(&ProxyChoice::Custom("\n".to_string())).is_err(),
            "空白字符会被拒绝"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_broken_proxy_address_error_does_not_echo_its_credentials() {
        let choice = crate::proxy::ProxyChoice::Custom("http://alice:s3cret@[::1".to_string());
        let error = build_client_with(&choice).unwrap_err().to_string();
        assert!(!error.contains("s3cret"), "{error}");
        assert!(!error.contains("alice"), "{error}");
    }

    fn apply_payloads(protocol: Protocol, payloads: &[&str]) -> (StreamOutcome, Vec<String>) {
        let mut outcome = StreamOutcome::default();
        let mut deltas: Vec<String> = Vec::new();
        let started = Instant::now();
        let mut sink = |d: &str| deltas.push(d.to_string());
        for payload in payloads {
            apply(protocol, payload, &mut outcome, started, &mut sink).unwrap();
        }
        (outcome, deltas)
    }

    #[test]
    fn openai_deltas_accumulate_and_are_pushed_out_in_order() {
        let (outcome, deltas) = apply_payloads(
            Protocol::OpenAi,
            &[
                r#"{"choices":[{"delta":{"content":"你"}}]}"#,
                r#"{"choices":[{"delta":{"content":"好"}}]}"#,
                "[DONE]",
            ],
        );
        assert_eq!(outcome.text, "你好");
        assert_eq!(deltas, vec!["你".to_string(), "好".to_string()]);
    }

    #[test]
    fn first_token_latency_is_recorded_once_for_the_first_delta() {
        let (outcome, _) = apply_payloads(
            Protocol::OpenAi,
            &[
                r#"{"choices":[{"delta":{"content":"a"}}]}"#,
                r#"{"choices":[{"delta":{"content":"b"}}]}"#,
            ],
        );
        assert!(outcome.first_token_ms.is_some(), "首字延迟必须被记录");
    }

    #[test]
    fn usage_split_across_events_is_merged_field_wise() {
        // Anthropic 就是这样：message_start 只给输入，message_delta 只给输出。
        let mut outcome = StreamOutcome::default();
        let started = Instant::now();
        let mut sink = |_: &str| {};
        apply(
            Protocol::Anthropic,
            r#"{"type":"message_start","message":{"usage":{"input_tokens":120,"output_tokens":0}}}"#,
            &mut outcome,
            started,
            &mut sink,
        )
        .unwrap();
        apply(
            Protocol::Anthropic,
            r#"{"type":"message_delta","usage":{"input_tokens":0,"output_tokens":64}}"#,
            &mut outcome,
            started,
            &mut sink,
        )
        .unwrap();
        assert_eq!(
            outcome.usage.input_tokens, 120,
            "输入用量被后一个事件清零了"
        );
        assert_eq!(outcome.usage.output_tokens, 64);
        assert!(!outcome.usage.estimated, "厂商给了数字就不该标成估算");
    }

    #[test]
    fn a_gemini_payload_with_text_and_usage_feeds_both() {
        let (outcome, deltas) = apply_payloads(
            Protocol::Gemini,
            &[
                r#"{"candidates":[{"content":{"parts":[{"text":"你好"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":8}}"#,
            ],
        );
        assert_eq!(outcome.text, "你好");
        assert_eq!(deltas, vec!["你好".to_string()]);
        assert_eq!(
            (outcome.usage.input_tokens, outcome.usage.output_tokens),
            (7, 8)
        );
    }

    #[test]
    fn done_event_terminates_the_stream() {
        let mut outcome = StreamOutcome::default();
        let started = Instant::now();
        let mut sink = |_: &str| {};
        let finished = apply(Protocol::OpenAi, "[DONE]", &mut outcome, started, &mut sink).unwrap();
        assert!(finished);
    }

    #[test]
    fn an_error_event_inside_the_stream_becomes_a_typed_error() {
        let mut outcome = StreamOutcome::default();
        let started = Instant::now();
        let mut sink = |_: &str| {};
        let result = apply(
            Protocol::OpenAi,
            r#"{"error":{"message":"boom"}}"#,
            &mut outcome,
            started,
            &mut sink,
        );
        assert!(matches!(result, Err(CoreError::BadResponse { .. })));
        // 已经收到的增量不能被丢掉——UI 至少还能显示半句译文。
        assert_eq!(outcome.text, "");
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_wait_that_never_finishes() {
        // 审查 L9：模型静默思考时没有分片可等，取消不能依赖「下一个分片到达」。
        let flag = AtomicBool::new(false);
        let waiting = cancellable(Some(&flag), std::future::pending::<()>());
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            flag.store(true, Ordering::Relaxed);
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(waiting, cancel)
        })
        .await
        .expect("置位后应当很快返回，而不是等那个永远不来的结果");
        assert_eq!(result, Err(CoreError::Cancelled));
    }

    #[tokio::test]
    async fn without_a_flag_the_work_simply_runs() {
        assert_eq!(cancellable(None, async { 7 }).await, Ok(7));
        let flag = AtomicBool::new(false);
        assert_eq!(cancellable(Some(&flag), async { 8 }).await, Ok(8));
    }

    #[test]
    fn stop_reasons_mark_the_outcome_truncated_or_complete() {
        // 审查 M4：触到输出上限要标出来，正常停止不能误标。
        let (outcome, _) = apply_payloads(
            Protocol::OpenAi,
            &[
                r#"{"choices":[{"delta":{"content":"半"}}]}"#,
                r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#,
                r#"{"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2}}"#,
            ],
        );
        assert!(outcome.truncated);
        assert!(outcome.stopped);
        assert_eq!(outcome.usage.output_tokens, 2, "停止原因之后的用量块不能丢");

        let (outcome, _) = apply_payloads(
            Protocol::Gemini,
            &[r#"{"candidates":[{"content":{"parts":[{"text":"全"}]},"finishReason":"STOP"}]}"#],
        );
        assert!(!outcome.truncated);
        assert!(outcome.stopped, "Gemini 的 STOP 就是它的结束信号");
    }

    /// 本机假服务：每个连接读完请求后停 `hold`，再回一段 OpenAI 风格的流。
    /// 返回地址与「同时在途的最大连接数」计数器。
    fn slow_openai_server(
        hold: Duration,
    ) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{BufRead, BufReader, Read, Write};
        use std::sync::atomic::AtomicUsize;
        use std::sync::Arc;

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}/v1", listener.local_addr().unwrap());
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let peak_out = peak.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { break };
                let (active, peak) = (active.clone(), peak.clone());
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(stream);
                    let mut length = 0usize;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                            break;
                        }
                        let lower = line.to_ascii_lowercase();
                        if let Some(value) = lower.strip_prefix("content-length:") {
                            length = value.trim().parse().unwrap_or(0);
                        }
                    }
                    let mut body = vec![0u8; length];
                    let _ = reader.read_exact(&mut body);

                    let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(hold);
                    active.fetch_sub(1, Ordering::SeqCst);

                    let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"译\"}}]}\n\n\
                               data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
                               data: [DONE]\n\n";
                    let mut stream = reader.into_inner();
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{sse}",
                        sse.len()
                    );
                });
            }
        });
        (address, peak_out)
    }

    #[tokio::test]
    async fn chunks_never_exceed_the_concurrency_cap_and_keep_their_separators() {
        // 审查：切分门槛降到几千字后长文动辄几十片，全部同时发出会把自己限流。
        let (base_url, peak) = slow_openai_server(Duration::from_millis(150));
        let client = build_client_with(&crate::proxy::ProxyChoice::Direct).unwrap();
        let provider = crate::provider::find_provider("openai").unwrap();
        let count = MAX_CONCURRENT_CHUNKS * 2 + 1;
        let requests: Vec<_> = (0..count)
            .map(|i| ChatRequest::new("system", format!("片{i}")))
            .collect();
        let separators: Vec<String> = (0..count)
            .map(|i| if i == 0 { String::new() } else { "\n\n".into() })
            .collect();

        let mut streamed = String::new();
        let mut sink = |delta: &str| streamed.push_str(delta);
        let outcome = stream_chunks(
            &client,
            &ChunkTarget {
                provider,
                base_url: Some(&base_url),
                model: "gpt-4o-mini",
                api_key: "sk-test",
            },
            &requests,
            &separators,
            &StreamOptions::default(),
            &mut sink,
        )
        .await
        .expect("假服务每片都回成功");

        let observed = peak.load(Ordering::SeqCst);
        assert!(
            observed <= MAX_CONCURRENT_CHUNKS,
            "同时在途 {observed} 片，超过上限 {MAX_CONCURRENT_CHUNKS}"
        );
        assert!(observed > 1, "仍应并发，而不是退化成串行");
        // 分片之间还原原文的段间空行，而不是只补一个换行。
        assert_eq!(outcome.text, vec!["译"; count].join("\n\n"));
        assert_eq!(streamed, outcome.text);
    }

    #[test]
    fn redirects_are_followed_only_within_the_same_origin() {
        // 审查 L34：跨源跳转会把 x-api-key 一类的头带到别的主机。
        let url = |s: &str| reqwest::Url::parse(s).unwrap();
        let from = url("https://api.example.com/v1/models");
        assert!(redirect_allowed(
            &from,
            &url("https://api.example.com/v1/models/")
        ));
        assert!(redirect_allowed(
            &from,
            &url("https://api.example.com:443/v2")
        ));
        assert!(!redirect_allowed(
            &from,
            &url("https://evil.example.net/v1")
        ));
        assert!(!redirect_allowed(&from, &url("http://api.example.com/v1")));
        assert!(!redirect_allowed(
            &from,
            &url("https://api.example.com:8443/v1")
        ));
    }
}
