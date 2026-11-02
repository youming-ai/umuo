//! 错误分类：把「一次失败的翻译」变成「用户能做的下一步」。
//!
//! PRD §7.5 要求错误不弹系统级警告框，只在结果卡片里给一条提示 + 可操作按钮
//! （重试 / 切换模型 / 打开设置）。所以这里的核心不是错误文案，而是
//! [`SuggestedAction`]：UI 直接照它渲染按钮，不需要自己判断「这个错误该不该给重试」。
//!
//! 分类的全部难点在 [`classify_http_error`]：各家 HTTP 状态码相同但语义不同
//! （同样的 429，可能是限流、可能是余额不足），必须读 body。

use std::time::Duration;

/// 结果卡片上可以给出的下一步动作。
///
/// 保持这个枚举很小是刻意的：每多一个动作，就要在 UI 上多一次取舍。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SuggestedAction {
    /// 再发一次同样的请求（限流、超时、5xx）。
    Retry,
    /// 换成备用模型（模型不可用、上下文超长）。
    SwitchModel,
    /// 打开「模型」设置页（Key 无效、余额不足、配置缺失）。
    OpenModelSettings,
    /// 检查网络或代理（不可达、DNS、TLS）。
    CheckNetwork,
    /// 切换到本地模型（离线时的降级路径，PRD §7.5）。
    UseLocalModel,
}

/// 内核错误分类。
///
/// 变体刻意按**用户视角**划分，而不是按 HTTP 状态码划分：同一个 429 既可能是
/// 限流（可重试），也可能是余额不足（不可重试），状态码本身不是可用的信息。
///
/// `Clone + PartialEq` 是必需的而不是顺手加的：流式事件（[`crate::wire::StreamEvent`]）
/// 要能复制与比较，于是错误类型必须跟着可复制——否则「同一次失败被报告两次」这类问题没法断言。
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum CoreError {
    #[error("尚未配置 API Key")]
    MissingKey,

    #[error("API Key 无效或已失效")]
    InvalidKey,

    #[error("额度或余额不足")]
    InsufficientBalance,

    #[error("请求过于频繁")]
    RateLimited { retry_after: Option<Duration> },

    #[error("请求超时")]
    Timeout { after: Duration },

    #[error("供应商服务异常（HTTP {status}）")]
    ServerError { status: u16 },

    #[error("网络不可达：{message}")]
    Network { message: String },

    #[error("当前地区不可用")]
    RegionBlocked,

    #[error("模型不可用：{model}")]
    ModelUnavailable { model: String },

    #[error("请求超出模型上下文长度")]
    ContextTooLong,

    #[error("响应格式不符合预期：{detail}")]
    BadResponse { detail: String },

    #[error("请求已取消")]
    Cancelled,

    /// 静默翻译写回前发现前台应用被换掉了（PRD §5.4）。
    ///
    /// 这是**保护**而不是故障：译文已经翻好了，只是不敢往一个可能已经变了的目标里写。
    #[error("目标应用已切换，已放弃替换原文")]
    WriteTargetChanged,

    #[error("写回原文失败：{detail}")]
    WriteBackFailed { detail: String },

    /// 译文没说完（触到输出上限或连接中断），静默翻译拒绝拿它替换原文（审查 M4）。
    ///
    /// 只在写回路径上出现：浮窗照常显示半截译文并附一条提醒，用户自己判断。
    #[error("译文不完整（输出被截断），已放弃替换原文")]
    Truncated,

    /// 选了「自定义端点」却没填 Base URL。
    ///
    /// 单独一个变体是必要的：不拦的话请求会打到一个空 URL，
    /// 用户看到的是一条莫名其妙的网络错误，完全不知道是自己没填地址。
    #[error("自定义端点还没填 Base URL")]
    CustomEndpointMissing,

    /// 选了 Azure OpenAI 却还没填资源终结点。
    ///
    /// 与自定义端点同一个理由：不拦的话请求会打到一个空地址，
    /// 用户看到的是一条莫名其妙的网络错误，完全不知道是自己没填。
    #[error("Azure OpenAI 还没填资源终结点")]
    AzureEndpointMissing,

    #[error("没有可用的模型配置")]
    NoEngine,
}

impl CoreError {
    /// 结果卡片上要给出的按钮，按优先级排序。
    ///
    /// 每个错误的动作集是**产品决策**而不是实现细节：例如「Key 无效」不给重试，
    /// 因为重试只会再失败一次、并把真正该做的事（去设置里改 Key）藏在后面。
    pub fn actions(&self) -> Vec<SuggestedAction> {
        match self {
            CoreError::RateLimited { .. } | CoreError::Timeout { .. } => {
                vec![SuggestedAction::Retry, SuggestedAction::SwitchModel]
            }
            // 5xx 与限流一样是「供应商侧的临时问题」：等一下或换一家都可能成功。
            CoreError::ServerError { .. } => {
                vec![SuggestedAction::Retry, SuggestedAction::SwitchModel]
            }
            CoreError::Network { .. } => vec![
                SuggestedAction::Retry,
                SuggestedAction::CheckNetwork,
                SuggestedAction::UseLocalModel,
            ],
            CoreError::InvalidKey | CoreError::MissingKey | CoreError::InsufficientBalance => {
                vec![SuggestedAction::OpenModelSettings]
            }
            CoreError::ModelUnavailable { .. } => vec![
                SuggestedAction::SwitchModel,
                SuggestedAction::OpenModelSettings,
            ],
            CoreError::ContextTooLong => {
                vec![SuggestedAction::SwitchModel, SuggestedAction::Retry]
            }
            CoreError::RegionBlocked => vec![
                SuggestedAction::OpenModelSettings,
                SuggestedAction::CheckNetwork,
            ],
            CoreError::BadResponse { .. } => vec![SuggestedAction::Retry],
            CoreError::Cancelled => vec![],
            // 写回失败不给「重试」：再点一次会重新翻译一遍再写一次，
            // 而在「目标已变」的情况下那正是我们要避免的行为。
            CoreError::WriteTargetChanged | CoreError::WriteBackFailed { .. } => vec![],
            // 截断多半是输出上限太小：换个模型最可能管用；连接中断的话重试也行。
            CoreError::Truncated => vec![SuggestedAction::SwitchModel, SuggestedAction::Retry],
            CoreError::CustomEndpointMissing
            | CoreError::AzureEndpointMissing
            | CoreError::NoEngine => {
                vec![SuggestedAction::OpenModelSettings]
            }
        }
    }
}

/// 把一次 HTTP 失败映射成 [`CoreError`]。
///
/// `body` 是响应体（可能为空、可能不是 JSON）。各家错误体形状不同，这里只做
/// **关键词匹配**而不是完整反序列化：这些错误体的字段在不同版本间变过，而我们要的
/// 只是「能不能重试」这一个判断，为它绑死 schema 不划算。
pub fn classify_http_error(status: u16, body: &str, retry_after: Option<Duration>) -> CoreError {
    let lower = body.to_ascii_lowercase();
    let has = |needle: &str| lower.contains(needle);

    // 5xx 最先判（审查 M6）：网关错误页里什么词都可能有（"balance" 出现在负载均衡的
    // 报错里），按关键词会把一次「等一下就好」的故障判成不可重试。
    if (500..600).contains(&status) {
        return CoreError::ServerError { status };
    }

    // 余额不足只认**明确的错误码**：429 配 "insufficient_quota" 是余额问题而非限流，
    // 两者的用户动作完全不同（一个是去充值，一个是等一下）。
    // 不认 "exceeded your current quota" 与裸的 "balance"：前者也是 Gemini 免费档
    // 每分钟限流的原话（RESOURCE_EXHAUSTED），后者太宽，误判后既不重试也不转移。
    // "credit balance is too low" 是 Anthropic 余额不足的固定文案（它没有专门的错误码）；
    // Moonshot 余额不足回 429 + `exceeded_current_quota_error`；
    // "arrear" 同时覆盖 arrears 与通义的 `Arrearage`。
    if has("insufficient_quota")
        || has("insufficient_balance")
        || has("insufficient balance")
        || has("credit balance is too low")
        || has("exceeded_current_quota_error")
        || has("arrear")
    {
        return CoreError::InsufficientBalance;
    }

    // Gemini 的配额与限流都是 RESOURCE_EXHAUSTED，等一下或换个模型就能好。
    if status == 429 || has("resource_exhausted") {
        return CoreError::RateLimited { retry_after };
    }

    if has("invalid_api_key")
        || has("incorrect api key")
        || has("api key not valid")
        || has("authentication_error")
        || has("invalid x-api-key")
    {
        return CoreError::InvalidKey;
    }

    if has("region") && (has("not supported") || has("unsupported") || has("restricted")) {
        return CoreError::RegionBlocked;
    }

    if has("context length")
        || has("context_length_exceeded")
        || has("maximum context")
        || has("too many tokens")
    {
        return CoreError::ContextTooLong;
    }

    if has("model_not_found")
        || has("does not exist")
        || has("no such model")
        || has("unknown model")
        || has("model not found")
    {
        return CoreError::ModelUnavailable {
            model: extract_model_name(body).unwrap_or_else(|| "未知".to_string()),
        };
    }

    match status {
        401 | 403 => CoreError::InvalidKey,
        402 => CoreError::InsufficientBalance,
        404 => CoreError::ModelUnavailable {
            model: extract_model_name(body).unwrap_or_else(|| "未知".to_string()),
        },
        // 408 与 5xx 是「再试一次可能就好」，属于供应商侧的临时问题。
        408 => CoreError::Timeout {
            after: Duration::from_secs(0),
        },
        451 => CoreError::RegionBlocked,
        // 400 且没匹配到任何已知关键词：多半是参数/模型名问题。
        400 => CoreError::BadResponse {
            detail: summarize(body),
        },
        _ => CoreError::BadResponse {
            detail: format!("HTTP {status}：{}", summarize(body)),
        },
    }
}

/// 从错误体里救出一个模型名——只为了让提示文案能说清是哪个模型不可用。
///
/// 两条路径都试：结构化字段（`error.model`）优先，其次从 message 里挖引号包裹的词
/// （OpenAI 的 `model_not_found` 就只把模型名写在 message 里，形如
/// ``The model `gpt-9` does not exist``）。
fn extract_model_name(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    if let Some(model) = value.pointer("/error/model").and_then(|v| v.as_str()) {
        if !model.trim().is_empty() {
            return Some(model.to_string());
        }
    }
    let message = value.pointer("/error/message").and_then(|v| v.as_str())?;
    extract_quoted(message)
}

/// 取出第一个被反引号/单引号/双引号包裹的片段。
fn extract_quoted(message: &str) -> Option<String> {
    for quote in ['`', '\'', '"'] {
        if let Some(start) = message.find(quote) {
            let rest = &message[start + quote.len_utf8()..];
            if let Some(end) = rest.find(quote) {
                let candidate = rest[..end].trim();
                if !candidate.is_empty() {
                    return Some(candidate.to_string());
                }
            }
        }
    }
    None
}

/// 错误体可能很长（有的供应商会回整段 Markdown），截断后再进 UI；
/// 同时经 [`redact_secrets`] 脱敏，防止第三方端点在 400/500 错误里原样回显 Key。
fn summarize(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "（空响应体）".to_string();
    }
    let redacted = redact_secrets(trimmed);
    let mut out: String = redacted.chars().take(200).collect();
    if redacted.chars().count() > 200 {
        out.push('…');
    }
    out
}

/// 把文本里像凭据的片段换成 `[REDACTED]`：供应商错误体、流内错误、代理与网络错误都要过它再进界面或日志。
///
/// 认的格式：`Bearer <token>`、`sk-…`（OpenAI 系与多数中转）、`AIza…`（Gemini）、
/// 恰好 32 位的独立十六进制串（Azure OpenAI 的 Key），以及 URL 里的 `user:pass@`（只去凭据、留主机，方便排查）。
/// 宁可多遮一个长得像的请求 id，也不能让 Key 原样出现在浮窗或日志里。
pub fn redact_secrets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    // 上一个原文字符是不是「词内」字符：32 位十六进制只在独立成词时才算 Key。
    let mut prev_word = false;
    while !rest.is_empty() {
        if let Some(after_bearer) = rest
            .strip_prefix("Bearer ")
            .or_else(|| rest.strip_prefix("bearer "))
        {
            out.push_str("Bearer [REDACTED]");
            let token_len = after_bearer
                .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ',' | '}' | ')'))
                .unwrap_or(after_bearer.len());
            rest = &after_bearer[token_len..];
            prev_word = false;
            continue;
        }
        if let Some(after_scheme) = rest.strip_prefix("://") {
            // 主机部分到第一个路径、查询或空白为止；其中有 `@` 就说明带了凭据。
            let authority_len = after_scheme
                .find(|c: char| {
                    c.is_whitespace() || matches!(c, '/' | '?' | '#' | '"' | '\'' | ')' | '>')
                })
                .unwrap_or(after_scheme.len());
            if let Some(at) = after_scheme[..authority_len].rfind('@') {
                out.push_str("://[REDACTED]@");
                rest = &after_scheme[at + 1..];
                prev_word = false;
                continue;
            }
        }
        let token_len = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
            .unwrap_or(rest.len());
        let token = &rest[..token_len];
        let is_secret = (token.starts_with("sk-") && token_len >= 8)
            || (token.starts_with("AIza") && token_len >= 30)
            || (!prev_word && token_len == 32 && token.bytes().all(|b| b.is_ascii_hexdigit()));
        if is_secret {
            out.push_str("[REDACTED]");
            rest = &rest[token_len..];
            prev_word = false;
            continue;
        }
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        rest = &rest[ch.len_utf8()..];
        prev_word = ch.is_alphanumeric() || ch == '-' || ch == '_';
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[test]
    fn quota_exhausted_on_429_is_not_treated_as_rate_limit() {
        // 这是本模块存在的理由：同样的状态码，用户该做的事完全不同。
        let body = r#"{"error":{"message":"You exceeded your current quota","type":"insufficient_quota"}}"#;
        let err = classify_http_error(429, body, Some(secs(20)));
        assert!(matches!(err, CoreError::InsufficientBalance));
        assert_eq!(err.actions(), vec![SuggestedAction::OpenModelSettings]);
    }

    #[test]
    fn genuine_rate_limit_keeps_retry_and_honours_retry_after() {
        let body = r#"{"error":{"message":"Rate limit reached","type":"rate_limit_exceeded"}}"#;
        let err = classify_http_error(429, body, Some(secs(7)));
        match err {
            CoreError::RateLimited { retry_after } => assert_eq!(retry_after, Some(secs(7))),
            other => panic!("期望 RateLimited，实际 {other:?}"),
        }
        assert_eq!(
            err.actions(),
            vec![SuggestedAction::Retry, SuggestedAction::SwitchModel]
        );
    }

    #[test]
    fn gemini_free_tier_quota_on_429_is_a_rate_limit_not_a_balance_problem() {
        // 审查 M6：Gemini 免费档一分钟内连发几次就是这句话，等几秒就好。
        let body = r#"{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}"#;
        let err = classify_http_error(429, body, None);
        assert!(matches!(err, CoreError::RateLimited { .. }), "{err:?}");
    }

    #[test]
    fn a_gateway_error_page_mentioning_balance_is_a_server_error() {
        let body = "<html><body>502 Bad Gateway: load balancer upstream unavailable</body></html>";
        let err = classify_http_error(502, body, None);
        assert_eq!(err, CoreError::ServerError { status: 502 });
        // 非 5xx 也不能因为一个裸词就判成余额不足。
        let err = classify_http_error(
            400,
            r#"{"error":{"message":"balance field is invalid"}}"#,
            None,
        );
        assert!(!matches!(err, CoreError::InsufficientBalance), "{err:?}");
    }

    #[test]
    fn explicit_balance_codes_still_win() {
        for (status, body) in [
            (
                402,
                r#"{"error":{"message":"Insufficient Balance","type":"unknown_error"}}"#,
            ),
            (
                400,
                r#"{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}"#,
            ),
            (429, r#"{"error":{"code":"insufficient_balance"}}"#),
            (
                429,
                r#"{"error":{"type":"exceeded_current_quota_error","message":"Your account is suspended"}}"#,
            ),
            (
                400,
                r#"{"code":"Arrearage","message":"Access denied, please make sure your account is in good standing."}"#,
            ),
        ] {
            assert_eq!(
                classify_http_error(status, body, None),
                CoreError::InsufficientBalance,
                "{body}"
            );
        }
    }

    #[test]
    fn a_truncated_translation_suggests_switching_model() {
        // 截断是在「成功」之后才判的：文本已经显示了，由用户决定要不要换模型再来。
        assert!(CoreError::Truncated
            .actions()
            .contains(&SuggestedAction::SwitchModel));
    }

    #[test]
    fn anthropic_auth_error_maps_to_invalid_key() {
        let body = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        let err = classify_http_error(401, body, None);
        assert!(matches!(err, CoreError::InvalidKey));
        // Key 错了不给重试：重试只会再错一次，把该做的事推到后面。
        assert_eq!(err.actions(), vec![SuggestedAction::OpenModelSettings]);
    }

    #[test]
    fn context_length_errors_are_recognised() {
        let body = r#"{"error":{"message":"This model's maximum context length is 8192 tokens"}}"#;
        let err = classify_http_error(400, body, None);
        assert!(matches!(err, CoreError::ContextTooLong));
    }

    #[test]
    fn unknown_model_is_extracted_by_name_for_the_message() {
        let body =
            r#"{"error":{"message":"The model `gpt-9` does not exist","code":"model_not_found"}}"#;
        let err = classify_http_error(404, body, None);
        match err {
            CoreError::ModelUnavailable { model } => assert_eq!(model, "gpt-9"),
            other => panic!("期望 ModelUnavailable，实际 {other:?}"),
        }
    }

    #[test]
    fn bare_500_is_retryable_but_summarised() {
        let err = classify_http_error(503, "", None);
        assert_eq!(
            err.actions(),
            vec![SuggestedAction::Retry, SuggestedAction::SwitchModel]
        );
    }

    #[test]
    fn long_error_bodies_are_truncated_before_reaching_the_ui() {
        let body = "x".repeat(1000);
        let err = classify_http_error(400, &body, None);
        match err {
            CoreError::BadResponse { detail } => {
                assert!(
                    detail.chars().count() <= 201,
                    "摘要未截断：{}",
                    detail.len()
                );
            }
            other => panic!("期望 BadResponse，实际 {other:?}"),
        }
    }

    #[test]
    fn a_missing_custom_endpoint_points_at_settings() {
        // 唯一有用的动作就是「去设置里把地址填上」。
        assert_eq!(
            CoreError::CustomEndpointMissing.actions(),
            vec![SuggestedAction::OpenModelSettings]
        );
    }

    #[test]
    fn cancellation_offers_no_action() {
        assert!(CoreError::Cancelled.actions().is_empty());
    }

    #[test]
    fn write_back_failures_offer_no_retry() {
        // 重试会重新翻译并再写一次，而那正是「目标已变」时要避免的行为；
        // 换模型更救不了「目标应用切走了」。
        for error in [
            CoreError::WriteTargetChanged,
            CoreError::WriteBackFailed {
                detail: "目标不可写".to_string(),
            },
        ] {
            assert!(error.actions().is_empty(), "{error:?} 不该给任何动作");
        }
    }

    #[test]
    fn error_summary_redacts_echoed_api_keys_and_bearer_tokens() {
        let body = r#"{"error":{"message":"Upstream rejected Bearer sk-proj-1234567890abcdef and key sk-abcdef123456"}}"#;
        let err = classify_http_error(400, body, None);
        match err {
            CoreError::BadResponse { detail } => {
                assert!(!detail.contains("sk-proj-1234567890abcdef"), "{detail}");
                assert!(!detail.contains("sk-abcdef123456"), "{detail}");
                assert!(detail.contains("[REDACTED]"), "{detail}");
            }
            other => panic!("期望 BadResponse，实际 {other:?}"),
        }
    }

    #[test]
    fn gemini_and_azure_keys_are_redacted_too() {
        let gemini = "AIzaSyA1234567890abcdefghijklmnopqrstuv";
        let azure = "0123456789abcdef0123456789ABCDEF";
        let text = format!("key={gemini} api-key: {azure} end");
        let redacted = redact_secrets(&text);
        assert!(!redacted.contains(gemini), "{redacted}");
        assert!(!redacted.contains(azure), "{redacted}");
        assert!(
            redacted.starts_with("key=") && redacted.ends_with(" end"),
            "{redacted}"
        );
    }

    #[test]
    fn longer_hex_runs_and_ordinary_words_are_left_alone() {
        // 只认恰好 32 位的独立十六进制串：64 位的哈希、普通单词与数字不动。
        let sha = "a".repeat(64);
        let text = format!("model gpt-4o-mini status 429 hash {sha} id deadbeef");
        assert_eq!(redact_secrets(&text), text);
    }

    #[test]
    fn credentials_in_urls_are_redacted() {
        let redacted = redact_secrets("代理 socks5://alice:s3cret@proxy.example:1080 连不上");
        assert!(!redacted.contains("alice"), "{redacted}");
        assert!(!redacted.contains("s3cret"), "{redacted}");
        assert!(
            redacted.contains("proxy.example:1080"),
            "主机留着，方便排查：{redacted}"
        );
        assert_eq!(
            redact_secrets("https://api.example.com/v1?x=1"),
            "https://api.example.com/v1?x=1",
            "没有凭据的地址原样保留"
        );
    }
}
