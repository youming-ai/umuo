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

use crate::error::{classify_http_error, CoreError};
use crate::provider::{Protocol, Provider};
use crate::wire::{
    build_chat_request_at, parse_stream_event, ChatRequest, SseDecoder, StreamEvent, TokenUsage,
    WireRequest,
};

/// 流中途允许的最大静默时间。超过它说明连接已经死了，继续等下去只会让用户干瞪眼。
pub const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(30);

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
                message: format!("代理地址不可用：{e}"),
            })?;
            builder = builder.proxy(proxy);
        }
    }

    builder.build().map_err(|e| CoreError::Network {
        message: e.to_string(),
    })
}

/// 一次流式翻译的结果。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StreamOutcome {
    pub text: String,
    pub usage: TokenUsage,
    /// 首字延迟（毫秒）。PRD §3.2 的 P50 ≤ 800 ms 指的就是它。
    pub first_token_ms: Option<u64>,
    pub total_ms: u64,
}

/// 分片并发翻译（PRD §6.3）：并发跑多个请求，按原文顺序输出增量。
///
/// 三个要点：
///
/// 1. **并发**：`FuturesUnordered` 同时推进所有分片，总耗时接近最慢的那一片，
///    而不是各片之和。长文本用串行会让用户等成倍的时间。
/// 2. **按序输出**：完成顺序不确定，所以未轮到的分片先存下来，
///    只吐「从游标开始连续就绪」的那一段（见 [`crate::chunk::drain_in_order`]）。
/// 3. **用量汇总**：多片各算各的 token，最后相加——按片的 usage 直接取一片会漏账。
///
/// 分片数量由调用方按 [`crate::chunk::split`] 决定，这里不重复算预算。
pub async fn stream_chunks(
    client: &reqwest::Client,
    target: &ChunkTarget<'_>,
    requests: &[ChatRequest],
    options: &StreamOptions<'_>,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> Result<StreamOutcome, CoreError> {
    use futures_util::stream::{FuturesUnordered, StreamExt};

    let started = std::time::Instant::now();
    let mut pending: Vec<Option<String>> = vec![None; requests.len()];
    // 已经按序吐出去的片段。单独收集而不是回头从 `pending` 拼——
    // 见函数末尾的注释。
    let mut merged: Vec<String> = Vec::with_capacity(requests.len());
    let mut cursor = 0usize;
    let mut usage = TokenUsage::default();
    let mut first_token_ms: Option<u64> = None;
    let mut inflight = FuturesUnordered::new();

    for (index, request) in requests.iter().enumerate() {
        let chunk_target = ChatTarget {
            provider: target.provider,
            base_url: target.base_url,
            model: target.model,
            api_key: target.api_key,
            chat: request,
        };
        inflight.push(async move {
            let mut buffer = String::new();
            let outcome = {
                let mut sink = |delta: &str| buffer.push_str(delta);
                stream_chat(client, &chunk_target, options, &mut sink).await
            };
            (index, buffer, outcome)
        });
    }

    let count = requests.len();
    let mut completed = 0usize;
    while let Some((index, buffer, outcome)) = inflight.next().await {
        let outcome = outcome?;
        usage.input_tokens += outcome.usage.input_tokens;
        usage.output_tokens += outcome.usage.output_tokens;
        // 估算是「或」的关系：只要有一片是估的，整体就不能声称精确。
        usage.estimated |= outcome.usage.estimated;
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
        for text in crate::chunk::with_separators(already_out, ready) {
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
            timeout: crate::router::DEFAULT_TIMEOUT,
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

    let response = send(client, &wire, options.timeout).await?;

    let status = response.status();
    if !status.is_success() {
        let retry_after = parse_retry_after(response.headers());
        // 错误体可能很长，但分类需要完整文本；截断只发生在进入 UI 之前。
        let body = response.text().await.unwrap_or_default();
        return Err(classify_http_error(status.as_u16(), &body, retry_after));
    }

    let protocol = provider.protocol;
    let mut decoder = SseDecoder::new();
    let mut stream = response.bytes_stream();
    let mut outcome = StreamOutcome::default();

    loop {
        if is_cancelled(options.cancel) {
            return Err(CoreError::Cancelled);
        }
        let next = tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.next()).await;
        let bytes = match next {
            Err(_) => {
                return Err(CoreError::Timeout {
                    after: STREAM_IDLE_TIMEOUT,
                })
            }
            Ok(None) => break,
            Ok(Some(Err(e))) => {
                return Err(CoreError::Network {
                    message: e.to_string(),
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
            break;
        }
    }

    // 流尾可能残留一个没有以空行收尾的事件；不处理它会丢掉最后一段译文。
    for payload in decoder.finish() {
        apply(protocol, &payload, &mut outcome, started, on_delta)?;
    }

    outcome.total_ms = started.elapsed().as_millis() as u64;

    if outcome.text.is_empty() {
        // 200 + 空内容是最容易被误解的失败形态：界面上会显示成「翻译成功但没有结果」。
        return Err(CoreError::BadResponse {
            detail: "流式响应没有产生任何内容".to_string(),
        });
    }
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
    match parse_stream_event(protocol, payload) {
        Some(StreamEvent::Delta(delta)) => {
            if outcome.first_token_ms.is_none() {
                outcome.first_token_ms = Some(started.elapsed().as_millis() as u64);
            }
            outcome.text.push_str(&delta);
            on_delta(&delta);
            Ok(false)
        }
        Some(StreamEvent::Usage(usage)) => {
            // 用量可能分多次到达（Anthropic 的 message_start 给输入、message_delta 给输出），
            // 所以按字段取较大值合并，而不是整块覆盖。
            outcome.usage.input_tokens = outcome.usage.input_tokens.max(usage.input_tokens);
            outcome.usage.output_tokens = outcome.usage.output_tokens.max(usage.output_tokens);
            if !usage.estimated {
                outcome.usage.estimated = false;
            }
            Ok(false)
        }
        Some(StreamEvent::Error(error)) => Err(error),
        Some(StreamEvent::Done) => Ok(true),
        None => Ok(false),
    }
}

/// 发一次非流式请求并取回文本（模型列表、Key 校验用）。
pub async fn fetch_json(
    client: &reqwest::Client,
    wire: &WireRequest,
    timeout: Duration,
) -> Result<String, CoreError> {
    let response = send(client, wire, timeout).await?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(classify_http_error(status.as_u16(), &body, None));
    }
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
        Ok(Err(e)) => Err(CoreError::Network {
            message: e.to_string(),
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

fn is_cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel
        .map(|flag| flag.load(Ordering::Relaxed))
        .unwrap_or(false)
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

    #[test]
    fn cancellation_flag_is_polled_between_chunks() {
        let flag = AtomicBool::new(false);
        assert!(!is_cancelled(Some(&flag)));
        flag.store(true, Ordering::Relaxed);
        assert!(is_cancelled(Some(&flag)));
        assert!(!is_cancelled(None), "没有取消标志时永远不取消");
    }
}
