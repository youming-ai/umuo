//! Token 计量（协议解析的一部分）。
//!
//! **以厂商返回为准**。能用响应里的 `usage` 就用，绝不「顺便估算一下」当成真值；
//! 估出来的数字必须带 [`TokenUsage::estimated`] 标记。
//! 费用估算、价目表与用量账本随费用报表与月度预算一起退出（PRD §5.10）。

use crate::wire::TokenUsage;

/// 本地估算 token 数。中日韩按 ~1 字符 1 token，拉丁按 ~4 字符 1 token。
///
/// 只在厂商没回 usage 时用作兜底，结果必须标记为估算。
pub fn estimate_tokens(text: &str) -> u32 {
    let mut cjk = 0f64;
    let mut other = 0f64;
    for ch in text.chars() {
        let c = ch as u32;
        if matches!(c, 0x3040..=0x30FF | 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xAC00..=0xD7AF) {
            cjk += 1.0;
        } else {
            other += 1.0;
        }
    }
    let total = cjk + other / 4.0;
    if total <= 0.0 {
        0
    } else {
        total.ceil() as u32
    }
}

/// 补齐缺失的用量：厂商没给数字时用本地估算，并把 `estimated` 打开。
///
/// 已经是估算值的结果不会被二次估算（避免重复调用时数字漂移）。
pub fn fill_missing_usage(usage: TokenUsage, input_text: &str, output_text: &str) -> TokenUsage {
    if !usage.estimated && usage.input_tokens > 0 && usage.output_tokens > 0 {
        return usage;
    }
    TokenUsage {
        input_tokens: if usage.input_tokens > 0 {
            usage.input_tokens
        } else {
            estimate_tokens(input_text)
        },
        output_tokens: if usage.output_tokens > 0 {
            usage.output_tokens
        } else {
            estimate_tokens(output_text)
        },
        estimated: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage(input: u32, output: u32) -> TokenUsage {
        TokenUsage {
            input_tokens: input,
            output_tokens: output,
            estimated: false,
        }
    }

    #[test]
    fn estimation_respects_script_density() {
        // 同样字符数，中文的 token 数应显著高于英文。
        let chinese = estimate_tokens("这是一段中文测试文本内容");
        let english = estimate_tokens("this is a piece of english text");
        assert!(chinese > english, "中文 {chinese} 应多于英文 {english}");
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn vendor_reported_usage_is_never_overwritten_by_an_estimate() {
        let real = usage(100, 200);
        let filled = fill_missing_usage(real, "忽略我", "忽略我");
        assert_eq!(filled, real);
        assert!(!filled.estimated);
    }

    #[test]
    fn missing_usage_is_filled_and_flagged_as_estimated() {
        let filled = fill_missing_usage(usage(0, 0), "hello world", "你好世界");
        assert!(filled.estimated, "估算值必须带标记");
        assert!(filled.input_tokens > 0);
        assert!(filled.output_tokens > 0);
    }

    #[test]
    fn partial_usage_only_fills_the_missing_half() {
        let filled = fill_missing_usage(usage(500, 0), "hello", "你好");
        assert_eq!(filled.input_tokens, 500, "厂商给的数字不能被覆盖");
        assert!(filled.output_tokens > 0);
        assert!(filled.estimated);
    }
}
