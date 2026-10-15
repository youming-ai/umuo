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
/// 与重试记录（[`crate::router::Attempt`]）都要能复制与比较，
/// 于是错误类型必须跟着可复制——否则「同一次失败被报告两次」这类问题没法断言。
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
            CoreError::CustomEndpointMissing
            | CoreError::AzureEndpointMissing
            | CoreError::NoEngine => {
                vec![SuggestedAction::OpenModelSettings]
            }
        }
    }

    /// 故障转移是否值得试下一个模型（PRD §6.3）。
    ///
    /// 注意「Key 无效」与「余额不足」**不**触发转移：备用模型用的是同一把 Key、
    /// 同一个账号，换模型救不回来，只会把一次明确的失败变成 N 次日志噪音。
    /// 写回失败同理：问题出在本机与目标应用之间，跟模型无关。
    pub fn is_failover_worthy(&self) -> bool {
        matches!(
            self,
            CoreError::RateLimited { .. }
                | CoreError::Timeout { .. }
                | CoreError::ServerError { .. }
                | CoreError::Network { .. }
                | CoreError::ModelUnavailable { .. }
                | CoreError::ContextTooLong
                | CoreError::BadResponse { .. }
        )
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

    // 先看 body 再看状态码：429 配 "insufficient_quota" 是余额问题而非限流，
    // 两者的用户动作完全不同（一个是去充值，一个是等一下）。
    if has("insufficient_quota")
        || has("insufficient_balance")
        || has("exceeded your current quota")
        || has("balance")
        || has("arrears")
    {
        return CoreError::InsufficientBalance;
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
        429 => CoreError::RateLimited { retry_after },
        451 => CoreError::RegionBlocked,
        // 400 且没匹配到任何已知关键词：多半是参数/模型名问题。
        400 => CoreError::BadResponse {
            detail: summarize(body),
        },
        s if (500..600).contains(&s) => CoreError::ServerError { status: s },
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

/// 错误体可能很长（有的供应商会回整段 Markdown），截断后再进 UI。
fn summarize(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "（空响应体）".to_string();
    }
    let mut out: String = trimmed.chars().take(200).collect();
    if trimmed.chars().count() > 200 {
        out.push('…');
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
        assert!(!err.is_failover_worthy());
    }

    #[test]
    fn genuine_rate_limit_keeps_retry_and_honours_retry_after() {
        let body = r#"{"error":{"message":"Rate limit reached","type":"rate_limit_exceeded"}}"#;
        let err = classify_http_error(429, body, Some(secs(7)));
        match err {
            CoreError::RateLimited { retry_after } => assert_eq!(retry_after, Some(secs(7))),
            other => panic!("期望 RateLimited，实际 {other:?}"),
        }
        assert!(err.is_failover_worthy());
        assert_eq!(
            err.actions(),
            vec![SuggestedAction::Retry, SuggestedAction::SwitchModel]
        );
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
    fn context_length_is_failover_worthy_so_long_text_can_fall_back() {
        let body = r#"{"error":{"message":"This model's maximum context length is 8192 tokens"}}"#;
        let err = classify_http_error(400, body, None);
        assert!(matches!(err, CoreError::ContextTooLong));
        assert!(err.is_failover_worthy());
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
        assert!(err.is_failover_worthy());
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
        assert!(!CoreError::CustomEndpointMissing.is_failover_worthy());
    }

    #[test]
    fn cancellation_offers_no_action() {
        assert!(CoreError::Cancelled.actions().is_empty());
    }

    #[test]
    fn write_back_failures_offer_no_retry_and_never_failover() {
        // 重试会重新翻译并再写一次，而那正是「目标已变」时要避免的行为；
        // 换模型更救不了「目标应用切走了」。
        for error in [
            CoreError::WriteTargetChanged,
            CoreError::WriteBackFailed {
                detail: "目标不可写".to_string(),
            },
        ] {
            assert!(error.actions().is_empty(), "{error:?} 不该给任何动作");
            assert!(!error.is_failover_worthy(), "{error:?} 不该触发故障转移");
        }
    }
}
