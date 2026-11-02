//! 线上协议层：请求构造、流式事件解析、响应解析。
//!
//! 这一层的存在理由：三家协议差异很大（Anthropic 的 `system` 是顶层参数、`max_tokens`
//! 必填、没有 `response_format`；Gemini 把模型名放在路径里、Key 放另一个 header），
//! 把这些差异集中在这里，路由、计量、UI 都不需要知道自己在跟谁说话。
//!
//! **请求构造与流式解析都是纯函数**——不碰网络。传输（reqwest）只负责把
//! [`WireRequest`] 发出去、把字节丢给 [`SseDecoder`]。这样「字节流 → 事件」这段
//! 最容易出错的逻辑可以在单元测试里被彻底覆盖，而不需要 mock HTTP 服务器。

use serde_json::json;

use crate::error::{redact_secrets, CoreError};
use crate::provider::ProviderKind;
use crate::provider::{Auth, Protocol, Provider};

/// Anthropic 要求显式声明版本。
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Anthropic 的 `max_tokens` 是必填项。给小了会把长段落截断成非法 JSON。
///
/// 公开出去是给分片预算用的（[`crate::chunk::char_budget`]）：一次请求的输出上限
/// 也要算进「这一片能放多少原文」，两边各写一个数迟早会漂开。
pub const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 8192;

/// 中立的对话请求。传输层负责把它映射成各家线上格式。
#[derive(Debug, Clone, PartialEq)]
pub struct ChatRequest {
    pub system: String,
    pub user: String,
    pub temperature: f32,
    /// 提示传输层尽量启用结构化输出。Anthropic 没有对应参数，只能靠 Prompt 约束。
    pub json_mode: bool,
    pub max_tokens: u32,
}

impl ChatRequest {
    pub fn new(system: impl Into<String>, user: impl Into<String>) -> Self {
        Self {
            system: system.into(),
            user: user.into(),
            temperature: 0.2,
            json_mode: false,
            max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
        }
    }

    pub fn json(mut self) -> Self {
        self.json_mode = true;
        self
    }

    pub fn temperature(mut self, t: f32) -> Self {
        self.temperature = if t.is_finite() { t } else { 0.2 };
        self
    }
}

/// 一个可以直接交给 HTTP 客户端的请求。
#[derive(Debug, Clone, PartialEq)]
pub struct WireRequest {
    pub method: &'static str,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

/// Token 用量。以厂商返回为准；缺失时由 [`crate::usage`] 本地估算并标注。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated: bool,
}

/// 流式输出的一个事件。
#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    /// 一段增量译文。
    Delta(String),
    /// 厂商在流中途或末尾给出的用量。
    Usage(TokenUsage),
    /// 正常结束。
    Done,
    /// 厂商报告了停止原因（审查 M4）。`truncated` = 输出没说完就停了：
    /// 触到输出上限（`length` / `max_tokens` / `MAX_TOKENS`）。
    ///
    /// 与 [`StreamEvent::Done`] 分开：OpenAI 的 `finish_reason` 块**之后**还有用量块与
    /// `[DONE]`，在这里就停会把用量丢掉；它只记状态，不结束读取。
    Finished { truncated: bool },
    /// 厂商在流里回了一个错误对象。
    Error(CoreError),
}

/// 构造一次对话请求，一律要求服务端流式返回：PRD §8 把首字延迟写成了发布门槛。
pub fn build_chat_request(
    provider: &Provider,
    model: &str,
    api_key: &str,
    req: &ChatRequest,
) -> Result<WireRequest, CoreError> {
    build_chat_request_at(provider, provider.base_url, model, api_key, req)
}

/// 同 [`build_chat_request`]，但显式指定 Base URL。
///
/// 存在的唯一理由是「自定义 OpenAI 兼容端点」：它的地址由用户填，
/// 而供应商目录里的字段是 `&'static str`，装不下运行时的字符串。
/// 其余供应商传 `provider.base_url` 即可。
pub fn build_chat_request_at(
    provider: &Provider,
    base_url: &str,
    model: &str,
    api_key: &str,
    req: &ChatRequest,
) -> Result<WireRequest, CoreError> {
    require_base_url(provider, base_url)?;
    if provider.requires_key() && api_key.trim().is_empty() {
        return Err(CoreError::MissingKey);
    }
    if model.trim().is_empty() {
        // 本机模型与自定义端点都可能还没有选模型；早点报错好过发出一个必然 404 的请求。
        return Err(CoreError::ModelUnavailable {
            model: "(未选择)".to_string(),
        });
    }

    let mut headers = vec![("content-type".to_string(), "application/json".to_string())];
    apply_auth(&mut headers, provider, api_key);

    match provider.protocol {
        Protocol::OpenAi => {
            let mut body = json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": req.system },
                    { "role": "user", "content": req.user },
                ],
                "temperature": req.temperature,
                "stream": true,
                // 不开这个开关，OpenAI 兼容的流式响应里根本不会带 usage，
                // 于是历史里的用量只能全部标注为估算。
                "stream_options": { "include_usage": true },
            });
            if req.json_mode {
                body["response_format"] = json!({ "type": "json_object" });
            }
            Ok(WireRequest {
                method: "POST",
                url: join_url(base_url, "chat/completions"),
                headers,
                body: Some(body.to_string()),
            })
        }
        Protocol::AzureOpenAi => {
            // 请求体与 OpenAI 完全一致：Azure 的差异只在 URL 形状与鉴权头。
            let mut body = json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": req.system },
                    { "role": "user", "content": req.user },
                ],
                "temperature": req.temperature,
                "stream": true,
                "stream_options": { "include_usage": true },
            });
            if req.json_mode {
                body["response_format"] = json!({ "type": "json_object" });
            }
            Ok(WireRequest {
                method: "POST",
                url: azure_chat_url(base_url, model),
                headers,
                body: Some(body.to_string()),
            })
        }
        Protocol::Anthropic => {
            headers.push((
                "anthropic-version".to_string(),
                ANTHROPIC_VERSION.to_string(),
            ));
            let body = json!({
                "model": model,
                "max_tokens": req.max_tokens,
                "system": req.system,
                "messages": [ { "role": "user", "content": req.user } ],
                // Anthropic 只接受 0..=1，而我们的范围是 0..=2（OpenAI 的上限）。
                // 按协议各夹一次，比为了迁就它把所有人的自由度都压到 1 更合适。
                "temperature": req.temperature.min(1.0),
                "stream": true,
            });
            Ok(WireRequest {
                method: "POST",
                url: join_url(base_url, "messages"),
                headers,
                body: Some(body.to_string()),
            })
        }
        Protocol::Gemini => {
            let verb = "streamGenerateContent?alt=sse";
            let mut body = json!({
                "systemInstruction": { "parts": [ { "text": req.system } ] },
                "contents": [
                    { "role": "user", "parts": [ { "text": req.user } ] }
                ],
                "generationConfig": { "temperature": req.temperature },
            });
            if req.json_mode {
                body["generationConfig"]["responseMimeType"] = json!("application/json");
            }
            let model = model.trim();
            let model = model.strip_prefix("models/").unwrap_or(model);
            Ok(WireRequest {
                method: "POST",
                // 模型名进路径是 Gemini 的协议特点，不是笔误。
                url: format!(
                    "{}/models/{}:{}",
                    base_url.trim_end_matches('/'),
                    urlencoding::encode(model),
                    verb
                ),
                headers,
                body: Some(body.to_string()),
            })
        }
    }
}

/// 空 Base URL 要在构造请求时就被拒绝。
///
/// 外层（设置的 `base_url_override`）已经拦过一道，但内核不该**静默**产出一个
/// 相对 URL——那种请求会打到本机某个不存在的路径，错误信息完全指不到原因。
fn require_base_url(provider: &Provider, base_url: &str) -> Result<(), CoreError> {
    if !base_url.trim().is_empty() {
        return Ok(());
    }
    Err(match provider.kind {
        ProviderKind::Azure => CoreError::AzureEndpointMissing,
        _ => CoreError::CustomEndpointMissing,
    })
}

/// Azure OpenAI 要求的 `api-version`。
///
/// Azure 与 OpenAI 最大的不同之一：**每个请求都要带一个 API 版本**，没有"默认"可用。
/// 这里钉一个稳定版本，而不是让用户填——版本选错会得到难以理解的报错，
/// 而它能决定的只是接口细节，不影响我们用的这几个字段。
pub const AZURE_API_VERSION: &str = "2024-10-21";

/// Azure 的聊天补全路径：模型名进**路径**，而且是部署名（PRD §6.1「含 Azure 部署」）。
fn azure_chat_url(base_url: &str, deployment: &str) -> String {
    format!(
        "{}/openai/deployments/{}/chat/completions?api-version={AZURE_API_VERSION}",
        base_url.trim_end_matches('/'),
        urlencoding::encode(deployment.trim())
    )
}

/// Azure 的模型列表路径。
fn azure_models_url(base_url: &str) -> String {
    format!(
        "{}/openai/models?api-version={AZURE_API_VERSION}",
        base_url.trim_end_matches('/')
    )
}

/// 构造「拉取可用模型列表」的请求（PRD §6.2 第 3 步：用真实 Key 校验并取回模型）。
pub fn build_models_request(provider: &Provider, api_key: &str) -> Result<WireRequest, CoreError> {
    build_models_request_at(provider, provider.base_url, api_key)
}

/// 同 [`build_models_request`]，但显式指定 Base URL（自定义端点用）。
pub fn build_models_request_at(
    provider: &Provider,
    base_url: &str,
    api_key: &str,
) -> Result<WireRequest, CoreError> {
    require_base_url(provider, base_url)?;
    if provider.requires_key() && api_key.trim().is_empty() {
        return Err(CoreError::MissingKey);
    }
    let mut headers: Vec<(String, String)> = Vec::new();
    apply_auth(&mut headers, provider, api_key);
    // 与对话请求一致：Anthropic 的每个请求都要声明版本（审查 M7）。
    if provider.protocol == Protocol::Anthropic {
        headers.push((
            "anthropic-version".to_string(),
            ANTHROPIC_VERSION.to_string(),
        ));
    }
    let url = match provider.protocol {
        // Azure 的模型列表也在 /openai 前缀下，并且要带 api-version。
        Protocol::AzureOpenAi => azure_models_url(base_url),
        _ => format!("{}/models", base_url.trim_end_matches('/')),
    };
    Ok(WireRequest {
        method: "GET",
        url,
        headers,
        body: None,
    })
}

fn apply_auth(headers: &mut Vec<(String, String)>, provider: &Provider, api_key: &str) {
    let key = api_key.trim();
    // 本机模型不需要 Key，此时不发鉴权头——带上一个空 Bearer 反而会被某些实现拒绝。
    if key.is_empty() {
        return;
    }
    match provider.auth {
        Auth::Bearer => headers.push(("authorization".to_string(), format!("Bearer {key}"))),
        Auth::XApiKey => headers.push(("x-api-key".to_string(), key.to_string())),
        Auth::XGoogApiKey => headers.push(("x-goog-api-key".to_string(), key.to_string())),
        // Azure 用的是 `api-key`，**不是** Bearer。发错头会得到 401，
        // 而报错内容不会告诉你"头名不对"。
        Auth::ApiKeyHeader => headers.push(("api-key".to_string(), key.to_string())),
    }
}

fn join_url(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path)
}

/// 从流式事件里取出增量与用量。`data` 是 SSE 的 payload（已去掉 `data: ` 前缀）。
///
/// 三家都把事件类型写在 payload 的 `type` 字段里，所以不需要 SSE 的 `event:` 行。
///
/// 返回多个事件：同一个 payload 里可能**同时**有文本和用量（Gemini 每块都带
/// `usageMetadata`；DeepSeek 的末块是 `content:""` 加 usage）。只返回其中一个，
/// 另一个就丢了——用量丢了的结果是历史里记成 0 token、$0，上限也跟着失明。
pub fn parse_stream_event(protocol: Protocol, data: &str) -> Vec<StreamEvent> {
    let data = data.trim();
    if data.is_empty() {
        return Vec::new();
    }
    // OpenAI 系的结束哨兵。收不到它而只是连接关闭时，调用方按「正常结束但可能截断」处理。
    if data == "[DONE]" {
        return vec![StreamEvent::Done];
    }

    let value: serde_json::Value = match serde_json::from_str(data) {
        Ok(v) => v,
        // 单条事件解析失败不废掉整条流：跳过它，后面的增量照样能显示。
        Err(_) => return Vec::new(),
    };

    // 文本在前、用量在后：顺序不影响累计结果，但让首字延迟按文本到达时刻算。
    let text_and_usage = |text: Option<&str>, usage: TokenUsage| {
        let mut events = Vec::new();
        if let Some(text) = text.filter(|s| !s.is_empty()) {
            events.push(StreamEvent::Delta(text.to_string()));
        }
        if usage.input_tokens > 0 || usage.output_tokens > 0 {
            events.push(StreamEvent::Usage(usage));
        }
        events
    };

    match protocol {
        Protocol::OpenAi | Protocol::AzureOpenAi => {
            if let Some(message) = value.pointer("/error/message").and_then(|v| v.as_str()) {
                return vec![StreamEvent::Error(CoreError::BadResponse {
                    detail: redact_secrets(message),
                })];
            }
            let mut events = text_and_usage(
                value
                    .pointer("/choices/0/delta/content")
                    .and_then(|v| v.as_str()),
                usage_from_openai(&value),
            );
            // `content_filter` 也是没说完：被过滤掉的那部分不会再来。
            match value
                .pointer("/choices/0/finish_reason")
                .and_then(|v| v.as_str())
            {
                Some("length" | "content_filter") => {
                    events.push(StreamEvent::Finished { truncated: true })
                }
                Some(_) => events.push(StreamEvent::Finished { truncated: false }),
                None => {}
            }
            events
        }
        Protocol::Anthropic => match value.get("type").and_then(|v| v.as_str()) {
            Some("content_block_delta") => value
                .pointer("/delta/text")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| vec![StreamEvent::Delta(s.to_string())])
                .unwrap_or_default(),
            Some("message_start") => {
                let usage = usage_from_anthropic(value.get("message").unwrap_or(&value));
                vec![StreamEvent::Usage(usage)]
            }
            // 输出用量与停止原因在同一个 message_delta 里，两个都要。
            Some("message_delta") => {
                let usage = usage_from_anthropic(&value);
                let mut events = vec![StreamEvent::Usage(usage)];
                if let Some(reason) = value.pointer("/delta/stop_reason").and_then(|v| v.as_str()) {
                    // `refusal` 是模型中途拒绝继续，同样没说完。
                    events.push(StreamEvent::Finished {
                        truncated: matches!(reason, "max_tokens" | "refusal"),
                    });
                }
                events
            }
            Some("message_stop") => vec![StreamEvent::Done],
            Some("error") => vec![StreamEvent::Error(CoreError::BadResponse {
                detail: redact_secrets(
                    value
                        .pointer("/error/message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("流式响应中返回错误"),
                ),
            })],
            _ => Vec::new(),
        },
        Protocol::Gemini => {
            if let Some(message) = value.pointer("/error/message").and_then(|v| v.as_str()) {
                return vec![StreamEvent::Error(CoreError::BadResponse {
                    detail: redact_secrets(message),
                })];
            }
            if let Some(prompt_feedback) = value.get("promptFeedback") {
                if prompt_feedback
                    .get("blockReason")
                    .and_then(|v| v.as_str())
                    .is_some()
                {
                    // 被安全策略拦下时没有 candidates，必须显式报错而不是静默空结果。
                    return vec![StreamEvent::Error(CoreError::BadResponse {
                        detail: "请求被 Gemini 安全策略拦截".to_string(),
                    })];
                }
            }
            let mut events = text_and_usage(
                value
                    .pointer("/candidates/0/content/parts/0/text")
                    .and_then(|v| v.as_str()),
                usage_from_gemini(&value),
            );
            // Gemini 没有结束哨兵，停止原因写在最后一块的 finishReason 里。
            match value
                .pointer("/candidates/0/finishReason")
                .and_then(|v| v.as_str())
            {
                Some("STOP") => events.push(StreamEvent::Finished { truncated: false }),
                Some("MAX_TOKENS") => events.push(StreamEvent::Finished { truncated: true }),
                // 其余（SAFETY、RECITATION、PROHIBITED_CONTENT……）多是被策略拦下：
                // 半截译文不能当成功，按失败报出来。
                Some(reason) if reason != "FINISH_REASON_UNSPECIFIED" => {
                    events.push(StreamEvent::Error(CoreError::BadResponse {
                        detail: format!("Gemini 中止了输出（{reason}）"),
                    }))
                }
                _ => {}
            }
            events
        }
    }
}

/// 从模型列表响应里取出模型 id（PRD §6.2 第 3 步）。
pub fn parse_models_list(protocol: Protocol, body: &str) -> Result<Vec<String>, CoreError> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| CoreError::BadResponse {
            detail: format!("模型列表不是合法 JSON：{e}"),
        })?;

    let mut out = Vec::new();
    match protocol {
        // OpenAI（含 Azure）、Anthropic 都是 { "data": [ { "id": ... } ] }
        Protocol::OpenAi | Protocol::AzureOpenAi | Protocol::Anthropic => {
            if let Some(items) = value.get("data").and_then(|v| v.as_array()) {
                for item in items {
                    if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        out.push(id.to_string());
                    }
                }
            }
        }
        Protocol::Gemini => {
            if let Some(items) = value.get("models").and_then(|v| v.as_array()) {
                for item in items {
                    if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                        // Gemini 返回的是 "models/gemini-2.0-flash"，进请求时要还原成短名。
                        out.push(name.strip_prefix("models/").unwrap_or(name).to_string());
                    }
                }
            }
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

fn usage_from_openai(value: &serde_json::Value) -> TokenUsage {
    TokenUsage {
        input_tokens: value
            .pointer("/usage/prompt_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        output_tokens: value
            .pointer("/usage/completion_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        estimated: false,
    }
}

fn usage_from_anthropic(value: &serde_json::Value) -> TokenUsage {
    TokenUsage {
        input_tokens: value
            .pointer("/usage/input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        output_tokens: value
            .pointer("/usage/output_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        estimated: false,
    }
}

fn usage_from_gemini(value: &serde_json::Value) -> TokenUsage {
    TokenUsage {
        input_tokens: value
            .pointer("/usageMetadata/promptTokenCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        output_tokens: value
            .pointer("/usageMetadata/candidatesTokenCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        estimated: false,
    }
}

/// SSE 增量解码器。
///
/// 按**字节**缓冲而不是按字符串：一个 UTF-8 字符完全可能被切在两个网络分片之间，
/// 先 `from_utf8_lossy` 再拼会把中日韩文本变成 �。只有在拿到完整事件时才解码。
#[derive(Debug, Default)]
pub struct SseDecoder {
    buf: Vec<u8>,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    /// 喂入一段字节，返回其中**已经完整**的事件 payload。
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        // 事件以空行分隔；\r\n 与 \n 都要认（各家中转层做法不一）。
        while let Some((index, sep_len)) = find_event_boundary(&self.buf) {
            let block: Vec<u8> = self.buf.drain(..index).collect();
            self.buf.drain(..sep_len);
            if let Some(payload) = payload_of(&block) {
                out.push(payload);
            }
        }
        out
    }

    /// 流结束时把残留的半个事件也吐出来（有些实现不以空行收尾）。
    pub fn finish(&mut self) -> Vec<String> {
        if self.buf.is_empty() {
            return Vec::new();
        }
        let block: Vec<u8> = std::mem::take(&mut self.buf);
        payload_of(&block).into_iter().collect()
    }
}

/// 找到第一个事件边界，返回（块长度, 分隔符长度）。
///
/// SSE 的事件分隔是**空行**，但空行有两种写法（`\n\n` 与 `\r\n\r\n`），
/// 各家中转层不一致，必须都认。
fn find_event_boundary(buf: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i < buf.len() {
        if buf[i] == b'\n' {
            if i >= 1 && buf[i - 1] == b'\r' {
                // \r\n\r\n：空行其实从 i-1 处的 \r 就开始了，块要切在它之前。
                if buf.len() > i + 2 && buf[i + 1] == b'\r' && buf[i + 2] == b'\n' {
                    return Some((i - 1, 4));
                }
            } else if buf.len() > i + 1 && buf[i + 1] == b'\n' {
                return Some((i, 2));
            }
        }
        i += 1;
    }
    None
}

/// 从一个 SSE 事件块里取出 `data:` 内容；没有 data 行（例如只有 event: 行）时返回 None。
fn payload_of(block: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(block);
    let mut parts: Vec<&str> = Vec::new();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(rest) = line.strip_prefix("data:") {
            parts.push(rest.strip_prefix(' ').unwrap_or(rest));
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::find_provider;

    fn openai() -> &'static Provider {
        find_provider("openai").unwrap()
    }

    fn azure() -> &'static Provider {
        find_provider("azure").unwrap()
    }

    #[test]
    fn in_stream_errors_redact_echoed_keys_for_every_protocol() {
        // 中转端点会在流内错误里原样回显 Key；这条文案直接进浮窗。
        for (protocol, payload) in [
            (
                Protocol::OpenAi,
                r#"{"error":{"message":"bad key sk-abcdef1234567890"}}"#,
            ),
            (
                Protocol::Anthropic,
                r#"{"type":"error","error":{"message":"bad key sk-abcdef1234567890"}}"#,
            ),
            (
                Protocol::Gemini,
                r#"{"error":{"message":"bad key sk-abcdef1234567890"}}"#,
            ),
        ] {
            let events = parse_stream_event(protocol, payload);
            let [StreamEvent::Error(CoreError::BadResponse { detail })] = events.as_slice() else {
                panic!("{protocol:?} 应报一条流内错误：{events:?}");
            };
            assert!(!detail.contains("sk-abcdef1234567890"), "{detail}");
        }
    }

    #[test]
    fn azure_puts_the_deployment_in_the_path_and_pins_the_api_version() {
        // Azure 与 OpenAI 的三处差异里，这条最容易被"兼容模式"糊弄过去：
        // 部署名在**路径**里，而且每个请求都要带 api-version。
        let request = ChatRequest::new("system", "user");
        let wire = build_chat_request_at(
            azure(),
            "https://my-resource.openai.azure.com",
            "my-gpt4o-deployment",
            "0123456789abcdef0123456789abcdef",
            &request,
        )
        .unwrap();

        assert_eq!(
            wire.url,
            format!(
                "https://my-resource.openai.azure.com/openai/deployments/my-gpt4o-deployment/chat/completions?api-version={AZURE_API_VERSION}"
            )
        );
        // 结尾多个斜杠不该出现 `//openai`。
        let trailing = build_chat_request_at(
            azure(),
            "https://my-resource.openai.azure.com/",
            "dep",
            "key",
            &request,
        )
        .unwrap();
        assert!(
            trailing.url.contains(".com/openai/deployments/dep/"),
            "{}",
            trailing.url
        );
    }

    #[test]
    fn azure_authenticates_with_the_api_key_header_not_bearer() {
        // 发错头会得到 401，而报错内容不会告诉你"头名不对"。
        let request = ChatRequest::new("system", "user");
        let wire = build_chat_request_at(
            azure(),
            "https://x.openai.azure.com",
            "dep",
            "secret",
            &request,
        )
        .unwrap();

        assert!(wire
            .headers
            .iter()
            .any(|(name, value)| name == "api-key" && value == "secret"));
        assert!(
            !wire.headers.iter().any(|(name, _)| name == "authorization"),
            "Azure 不接受 Bearer"
        );
    }

    #[test]
    fn azure_models_list_uses_the_openai_prefix_and_api_version() {
        let wire =
            build_models_request_at(azure(), "https://x.openai.azure.com", "secret").unwrap();
        assert_eq!(
            wire.url,
            format!("https://x.openai.azure.com/openai/models?api-version={AZURE_API_VERSION}")
        );
    }

    #[test]
    fn azure_without_an_endpoint_is_refused() {
        // 地址为空时构造请求必须失败，而不是产出一个相对 URL。
        let request = ChatRequest::new("system", "user");
        let result = build_chat_request_at(azure(), "", "dep", "secret", &request);
        assert!(result.is_err());
    }

    #[test]
    fn missing_key_is_reported_before_any_request_is_built() {
        let err = build_chat_request(openai(), "gpt-4o-mini", "", &ChatRequest::new("s", "u"))
            .unwrap_err();
        assert!(matches!(err, CoreError::MissingKey));
    }

    #[test]
    fn local_model_needs_no_key_and_sends_no_auth_header() {
        let ollama = find_provider("ollama").unwrap();
        let wire = build_chat_request(ollama, "llama3.2", "", &ChatRequest::new("s", "u"))
            .expect("本机模型不该要求 Key");
        assert!(
            !wire.headers.iter().any(|(k, _)| k == "authorization"),
            "本机模型不该发鉴权头"
        );
    }

    #[test]
    fn api_key_never_appears_in_the_body() {
        // 这条是 BYOK 的安全不变量：Key 只进 header，不进 body（也就不会进日志）。
        let wire = build_chat_request(
            openai(),
            "gpt-4o-mini",
            "sk-secret-value",
            &ChatRequest::new("sys", "user"),
        )
        .unwrap();
        let body = wire.body.unwrap();
        assert!(!body.contains("sk-secret-value"), "Key 泄漏进了请求体");
        assert!(wire
            .headers
            .iter()
            .any(|(k, v)| k == "authorization" && v == "Bearer sk-secret-value"));
    }

    #[test]
    fn openai_streaming_asks_for_usage_otherwise_accounting_is_blind() {
        let wire = build_chat_request(openai(), "gpt-4o-mini", "sk-x", &ChatRequest::new("s", "u"))
            .unwrap();
        let body: serde_json::Value = serde_json::from_str(&wire.body.unwrap()).unwrap();
        assert_eq!(body["stream"], true);
        assert_eq!(body["stream_options"]["include_usage"], true);
        assert_eq!(body["messages"][0]["role"], "system");
    }

    #[test]
    fn anthropic_puts_system_at_top_level_and_requires_max_tokens() {
        let anthropic = find_provider("anthropic").unwrap();
        let wire = build_chat_request(
            anthropic,
            "claude-3-5-haiku-latest",
            "sk-ant-x",
            &ChatRequest::new("SYS", "USER"),
        )
        .unwrap();
        let body: serde_json::Value = serde_json::from_str(&wire.body.unwrap()).unwrap();
        assert_eq!(body["system"], "SYS");
        assert!(body["max_tokens"].as_u64().unwrap() > 0, "max_tokens 必填");
        assert_eq!(body["messages"][0]["content"], "USER");
        // Anthropic 没有 response_format，json_mode 不能变成非法字段。
        assert!(body.get("response_format").is_none());
        assert!(wire.headers.iter().any(|(k, _)| k == "x-api-key"));
        assert!(wire.headers.iter().any(|(k, _)| k == "anthropic-version"));
    }

    #[test]
    fn gemini_puts_the_model_in_the_path_and_uses_sse() {
        let gemini = find_provider("gemini").unwrap();
        let wire = build_chat_request(
            gemini,
            "gemini-2.0-flash",
            "AIza-x",
            &ChatRequest::new("s", "u").json(),
        )
        .unwrap();
        assert!(wire
            .url
            .ends_with("/models/gemini-2.0-flash:streamGenerateContent?alt=sse"));
        let body: serde_json::Value = serde_json::from_str(&wire.body.unwrap()).unwrap();
        assert_eq!(
            body["generationConfig"]["responseMimeType"],
            "application/json"
        );
        assert!(wire.headers.iter().any(|(k, _)| k == "x-goog-api-key"));
    }

    #[test]
    fn sse_decoder_splits_events_across_arbitrary_chunk_boundaries() {
        let mut decoder = SseDecoder::new();
        // 故意在事件中间、以及一个多字节汉字中间切分。
        let bytes = "data: {\"a\":1}\n\ndata: {\"b\":".as_bytes();
        assert_eq!(decoder.push(bytes), vec!["{\"a\":1}".to_string()]);
        let rest = "2}\n\n".as_bytes();
        assert_eq!(decoder.push(rest), vec!["{\"b\":2}".to_string()]);
    }

    #[test]
    fn sse_decoder_does_not_corrupt_multibyte_text_split_across_chunks() {
        // 「你好」的 UTF-8 是 6 字节，第 2、3 字节之间切开——这是最容易出错的地方。
        let payload = "data: {\"t\":\"你好\"}\n\n";
        let bytes = payload.as_bytes();
        let split = 13; // 「你」占 12..15，切在 13 就是字节中间
        assert!(
            !std::str::from_utf8(&bytes[..split]).is_ok(),
            "测试前提：切点必须落在多字节字符中间"
        );

        let mut decoder = SseDecoder::new();
        assert!(decoder.push(&bytes[..split]).is_empty());
        let events = decoder.push(&bytes[split..]);
        assert_eq!(events, vec!["{\"t\":\"你好\"}".to_string()]);
    }

    #[test]
    fn sse_decoder_accepts_crlf_and_trailing_partial_event() {
        let mut decoder = SseDecoder::new();
        let events = decoder.push(b"data: first\r\n\r\n");
        assert_eq!(events, vec!["first".to_string()]);
        // 流尾没有空行时，finish 必须把最后一条吐出来，否则最后一段译文会丢。
        assert!(decoder.push(b"data: last").is_empty());
        assert_eq!(decoder.finish(), vec!["last".to_string()]);
    }

    #[test]
    fn openai_done_sentinel_and_delta_are_distinguished() {
        assert_eq!(
            parse_stream_event(Protocol::OpenAi, "[DONE]"),
            vec![StreamEvent::Done]
        );
        assert_eq!(
            parse_stream_event(
                Protocol::OpenAi,
                r#"{"choices":[{"delta":{"content":"你"}}]}"#
            ),
            vec![StreamEvent::Delta("你".to_string())]
        );
        // 无法解析的事件被跳过，而不是让整条流中断。
        assert!(parse_stream_event(Protocol::OpenAi, "{oops").is_empty());
    }

    #[test]
    fn openai_usage_chunk_is_reported_once_and_not_mistaken_for_text() {
        let event = parse_stream_event(
            Protocol::OpenAi,
            r#"{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}"#,
        );
        match event.as_slice() {
            [StreamEvent::Usage(u)] => {
                assert_eq!((u.input_tokens, u.output_tokens), (10, 20));
            }
            other => panic!("期望 Usage，实际 {other:?}"),
        }
    }

    fn usage(input: u32, output: u32) -> StreamEvent {
        StreamEvent::Usage(TokenUsage {
            input_tokens: input,
            output_tokens: output,
            estimated: false,
        })
    }

    #[test]
    fn deepseek_final_chunk_with_empty_content_still_reports_usage() {
        // DeepSeek 的末块是 `content:""` 加 usage：空文本要丢，用量要留。
        let events = parse_stream_event(
            Protocol::OpenAi,
            r#"{"choices":[{"delta":{"content":""}}],"usage":{"prompt_tokens":10,"completion_tokens":20}}"#,
        );
        assert_eq!(events, vec![usage(10, 20)]);
    }

    #[test]
    fn openai_chunk_with_text_and_usage_yields_both() {
        let events = parse_stream_event(
            Protocol::OpenAi,
            r#"{"choices":[{"delta":{"content":"好"}}],"usage":{"prompt_tokens":3,"completion_tokens":4}}"#,
        );
        assert_eq!(
            events,
            vec![StreamEvent::Delta("好".to_string()), usage(3, 4)]
        );
    }

    #[test]
    fn gemini_chunk_with_text_keeps_its_usage_metadata() {
        // Gemini 每块都带 usageMetadata；只看文本的话用量永远是 0。
        let events = parse_stream_event(
            Protocol::Gemini,
            r#"{"candidates":[{"content":{"parts":[{"text":"你好"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":8}}"#,
        );
        assert_eq!(
            events,
            vec![StreamEvent::Delta("你好".to_string()), usage(7, 8)]
        );
    }

    #[test]
    fn anthropic_stream_events_are_read_from_the_payload_type() {
        assert_eq!(
            parse_stream_event(
                Protocol::Anthropic,
                r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"译"}}"#
            ),
            vec![StreamEvent::Delta("译".to_string())]
        );
        assert_eq!(
            parse_stream_event(Protocol::Anthropic, r#"{"type":"message_stop"}"#),
            vec![StreamEvent::Done]
        );
        assert!(parse_stream_event(Protocol::Anthropic, r#"{"type":"ping"}"#).is_empty());
    }

    #[test]
    fn stop_reasons_are_read_from_every_protocol() {
        // 审查 M4：触到输出上限的译文不能当完整结果。
        let finished = |truncated| StreamEvent::Finished { truncated };
        assert_eq!(
            parse_stream_event(
                Protocol::OpenAi,
                r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#
            ),
            vec![finished(true)]
        );
        assert_eq!(
            parse_stream_event(
                Protocol::OpenAi,
                r#"{"choices":[{"delta":{"content":"完"},"finish_reason":"stop"}]}"#
            ),
            vec![StreamEvent::Delta("完".to_string()), finished(false)]
        );
        assert_eq!(
            parse_stream_event(
                Protocol::Anthropic,
                r#"{"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":8192}}"#
            ),
            vec![usage(0, 8192), finished(true)]
        );
        assert_eq!(
            parse_stream_event(
                Protocol::Anthropic,
                r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}"#
            ),
            vec![usage(0, 5), finished(false)]
        );
        assert_eq!(
            parse_stream_event(
                Protocol::Gemini,
                r#"{"candidates":[{"content":{"parts":[{"text":"半"}]},"finishReason":"MAX_TOKENS"}]}"#
            ),
            vec![StreamEvent::Delta("半".to_string()), finished(true)]
        );
        assert_eq!(
            parse_stream_event(
                Protocol::Gemini,
                r#"{"candidates":[{"content":{"parts":[{"text":"全"}]},"finishReason":"STOP"}]}"#
            ),
            vec![StreamEvent::Delta("全".to_string()), finished(false)]
        );
    }

    #[test]
    fn a_gemini_safety_stop_is_an_error_even_after_some_text() {
        let events = parse_stream_event(
            Protocol::Gemini,
            r#"{"candidates":[{"content":{"parts":[{"text":"半"}]},"finishReason":"SAFETY"}]}"#,
        );
        assert!(matches!(
            events.as_slice(),
            [StreamEvent::Delta(_), StreamEvent::Error(_)]
        ));
    }

    #[test]
    fn the_anthropic_models_request_declares_the_api_version() {
        // 审查 M7：只带 Key 不带版本头，拉模型列表可能被拒。
        let anthropic = crate::provider::find_provider("anthropic").unwrap();
        let wire = build_models_request(anthropic, "sk-ant").unwrap();
        assert!(wire
            .headers
            .iter()
            .any(|(name, value)| name == "anthropic-version" && value == ANTHROPIC_VERSION));
        let openai = crate::provider::find_provider("openai").unwrap();
        let wire = build_models_request(openai, "sk").unwrap();
        assert!(!wire
            .headers
            .iter()
            .any(|(name, _)| name == "anthropic-version"));
    }

    #[test]
    fn gemini_blocked_response_is_an_error_not_an_empty_translation() {
        // 被安全策略拦截时没有 candidates；静默返回空串会让用户以为模型翻了空。
        let event = parse_stream_event(
            Protocol::Gemini,
            r#"{"promptFeedback":{"blockReason":"SAFETY"}}"#,
        );
        assert!(matches!(event.as_slice(), [StreamEvent::Error(_)]));
    }

    #[test]
    fn anthropic_gets_its_temperature_clamped_to_one_but_openai_does_not() {
        // 两条分支各夹各的：把 OpenAI 也压到 1 会悄悄拿掉用户要的自由度，
        // 而不管 Anthropic 会让它直接拒掉请求。
        let hot = ChatRequest::new("s", "u").temperature(1.8);

        let openai_wire = build_chat_request(
            find_provider("openai").unwrap(),
            "gpt-4o-mini",
            "sk-x",
            &hot,
        )
        .unwrap();
        let openai_body: serde_json::Value =
            serde_json::from_str(openai_wire.body.as_deref().unwrap()).unwrap();
        // f32 → JSON 数（f64）会留下表示误差，只能近似比。
        let openai_temp = openai_body["temperature"].as_f64().unwrap();
        assert!(
            (openai_temp - 1.8).abs() < 1e-6,
            "OpenAI 接受 0..=2，实际 {openai_temp}"
        );

        let anthropic_wire = build_chat_request(
            find_provider("anthropic").unwrap(),
            "claude-sonnet-4-5",
            "sk-x",
            &hot,
        )
        .unwrap();
        let anthropic_body: serde_json::Value =
            serde_json::from_str(anthropic_wire.body.as_deref().unwrap()).unwrap();
        assert_eq!(
            anthropic_body["temperature"].as_f64().unwrap(),
            1.0,
            "Anthropic 只接受到 1"
        );
    }

    #[test]
    fn a_nan_temperature_never_becomes_an_invalid_json_body() {
        // NaN 序列化进 JSON 会变成 null，供应商那边报参数错误，
        // 用户看到的却是一条无从下手的网络错误。
        let safe = ChatRequest::new("s", "u").temperature(f32::NAN);

        let wire = build_chat_request(
            find_provider("openai").unwrap(),
            "gpt-4o-mini",
            "sk-x",
            &safe,
        )
        .unwrap();
        let body: serde_json::Value = serde_json::from_str(wire.body.as_deref().unwrap()).unwrap();
        assert!(
            body["temperature"].is_number(),
            "温度必须是数字，实际 {body}"
        );
    }

    #[test]
    fn an_explicit_base_url_wins_over_the_catalogue_default() {
        // 「自定义 OpenAI 兼容端点」整条功能就靠这个：地址来自用户，不在目录里。
        let custom = find_provider("custom").unwrap();
        let wire = build_chat_request_at(
            custom,
            "https://my-gateway.internal/v1",
            "my-model",
            "sk-x",
            &ChatRequest::new("s", "u"),
        )
        .unwrap();
        assert_eq!(wire.url, "https://my-gateway.internal/v1/chat/completions");
    }

    #[test]
    fn the_default_entry_point_still_uses_the_catalogue_url() {
        // 上面那个显式入口不该把默认行为改掉。
        let wire = build_chat_request(openai(), "gpt-4o-mini", "sk-x", &ChatRequest::new("s", "u"))
            .unwrap();
        assert_eq!(wire.url, "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn model_lists_are_normalised_across_protocols() {
        let openai = parse_models_list(
            Protocol::OpenAi,
            r#"{"data":[{"id":"gpt-4o-mini"},{"id":"gpt-4o"}]}"#,
        )
        .unwrap();
        assert_eq!(
            openai,
            vec!["gpt-4o".to_string(), "gpt-4o-mini".to_string()]
        );

        // Gemini 的 "models/xxx" 前缀必须去掉，否则拼进 URL 会变成 /models/models/xxx。
        let gemini = parse_models_list(
            Protocol::Gemini,
            r#"{"models":[{"name":"models/gemini-2.0-flash"}]}"#,
        )
        .unwrap();
        assert_eq!(gemini, vec!["gemini-2.0-flash".to_string()]);
    }

    #[test]
    fn empty_model_selection_fails_early_instead_of_404ing_later() {
        let ollama = find_provider("ollama").unwrap();
        let err = build_chat_request(ollama, "", "", &ChatRequest::new("s", "u")).unwrap_err();
        assert!(matches!(err, CoreError::ModelUnavailable { .. }));
    }

    #[test]
    fn gemini_and_azure_encode_model_and_deployment_in_url_path() {
        let gemini = find_provider("gemini").unwrap();
        let g_wire = build_chat_request(
            gemini,
            " models/gemini 2.0/exp?foo=1 ",
            "AIza-x",
            &ChatRequest::new("s", "u"),
        )
        .unwrap();
        assert!(
            g_wire
                .url
                .ends_with("/models/gemini%202.0%2Fexp%3Ffoo%3D1:streamGenerateContent?alt=sse"),
            "实际 URL：{}",
            g_wire.url
        );

        let a_wire = build_chat_request_at(
            azure(),
            "https://x.openai.azure.com",
            " my dep/v1?x=2 ",
            "secret",
            &ChatRequest::new("s", "u"),
        )
        .unwrap();
        assert_eq!(
            a_wire.url,
            format!(
                "https://x.openai.azure.com/openai/deployments/my%20dep%2Fv1%3Fx%3D2/chat/completions?api-version={AZURE_API_VERSION}"
            )
        );
    }
}
