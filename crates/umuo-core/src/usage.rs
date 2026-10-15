//! Token 计量与费用估算（PRD §5.10）。
//!
//! 两条原则：
//!
//! 1. **以厂商返回为准**。能用响应里的 `usage` 就用，绝不「顺便估算一下」当成真值；
//!    估出来的数字必须带 [`TokenUsage::estimated`] 标记，UI 要显示「估算」。
//! 2. **价格表是可替换的数据**。PRD 要求它「远程可更新」，所以查表函数接受一张表，
//!    [`BUILTIN_PRICES`] 只是离线兜底；表里没有的模型宁可返回 `None`
//!    （UI 显示「无价格信息」），也不要用一个相近模型的单价冒充——那是在编数字。

use crate::wire::TokenUsage;

/// 一条模型价格。单位是「美元 / 百万 token」。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelPrice {
    /// 供应商 id；`"*"` 表示对所有供应商生效。
    pub provider_id: &'static str,
    /// 模型名前缀。匹配时取**最长命中**，这样 `gpt-4o-mini` 不会被 `gpt-4o` 抢走。
    pub model_prefix: &'static str,
    pub input_usd_per_mtok: f64,
    pub output_usd_per_mtok: f64,
}

/// 内置兜底价格表。
///
/// 注意这不是「当前价格」——供应商调价是常态，这张表的用途只是让用户在断网、
/// 或远程价格表还没拉到时不至于看到一个空白。数值来自 PRD §10.3 的成本假设。
pub const BUILTIN_PRICES: &[ModelPrice] = &[
    ModelPrice {
        provider_id: "openai",
        model_prefix: "gpt-4o-mini",
        input_usd_per_mtok: 0.15,
        output_usd_per_mtok: 0.60,
    },
    ModelPrice {
        provider_id: "openai",
        model_prefix: "gpt-4o",
        input_usd_per_mtok: 2.50,
        output_usd_per_mtok: 10.00,
    },
    ModelPrice {
        provider_id: "anthropic",
        model_prefix: "claude-3-5-haiku",
        input_usd_per_mtok: 0.80,
        output_usd_per_mtok: 4.00,
    },
    ModelPrice {
        provider_id: "anthropic",
        model_prefix: "claude-3-5-sonnet",
        input_usd_per_mtok: 3.00,
        output_usd_per_mtok: 15.00,
    },
    ModelPrice {
        provider_id: "gemini",
        model_prefix: "gemini-2.0-flash",
        input_usd_per_mtok: 0.10,
        output_usd_per_mtok: 0.40,
    },
    ModelPrice {
        provider_id: "deepseek",
        model_prefix: "deepseek-chat",
        input_usd_per_mtok: 0.27,
        output_usd_per_mtok: 1.10,
    },
    // 本机模型没有 API 账单；0 是**正确**的值而不是缺失。
    ModelPrice {
        provider_id: "ollama",
        model_prefix: "",
        input_usd_per_mtok: 0.0,
        output_usd_per_mtok: 0.0,
    },
    ModelPrice {
        provider_id: "lmstudio",
        model_prefix: "",
        input_usd_per_mtok: 0.0,
        output_usd_per_mtok: 0.0,
    },
];

/// 在一张价格表里查价：先按供应商匹配，再取最长命中的模型前缀。
pub fn lookup_price<'a>(
    table: &'a [ModelPrice],
    provider_id: &str,
    model: &str,
) -> Option<&'a ModelPrice> {
    table
        .iter()
        .filter(|p| p.provider_id == provider_id || p.provider_id == "*")
        .filter(|p| model.starts_with(p.model_prefix))
        .max_by_key(|p| p.model_prefix.len())
}

/// 用内置表查价。
pub fn builtin_price(provider_id: &str, model: &str) -> Option<&'static ModelPrice> {
    lookup_price(BUILTIN_PRICES, provider_id, model)
}

/// 按用量与单价算费用（美元）。单价单位是「美元 / 百万 token」。
pub fn cost_usd(usage: TokenUsage, price: &ModelPrice) -> f64 {
    let input = usage.input_tokens as f64 * price.input_usd_per_mtok / 1_000_000.0;
    let output = usage.output_tokens as f64 * price.output_usd_per_mtok / 1_000_000.0;
    input + output
}

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

/// 一条账目。写进本地库，用于「按日 / 月展示费用」（PRD §5.10）。
#[derive(Debug, Clone, PartialEq)]
pub struct LedgerEntry {
    /// Unix 秒。
    pub at: i64,
    pub provider_id: String,
    pub model: String,
    pub usage: TokenUsage,
    pub cost_usd: f64,
}

/// 最近 `days` 天（按 `now` 起算）的总花费。
pub fn cost_since(entries: &[LedgerEntry], now: i64, days: i64) -> f64 {
    let cutoff = now - days * 86_400;
    entries
        .iter()
        .filter(|e| e.at >= cutoff)
        .map(|e| e.cost_usd)
        .sum()
}

/// 是否已经超出月度上限（PRD §5.10「支持按 Provider 设月度上限」）。
///
/// 上限为 `None` 表示用户没设，永远不超。
pub fn over_cap(spent_usd: f64, cap_usd: Option<f64>) -> bool {
    matches!(cap_usd, Some(cap) if cap > 0.0 && spent_usd >= cap)
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
    fn cost_is_linear_in_tokens() {
        let price = ModelPrice {
            provider_id: "x",
            model_prefix: "",
            input_usd_per_mtok: 0.20,
            output_usd_per_mtok: 1.25,
        };
        // 1000 输入 + 1000 输出 = 0.0002 + 0.00125
        let cost = cost_usd(usage(1000, 1000), &price);
        assert!((cost - 0.00145).abs() < 1e-9, "实际 {cost}");
        assert_eq!(cost_usd(usage(0, 0), &price), 0.0);
    }

    #[test]
    fn longest_model_prefix_wins_so_mini_is_not_priced_as_full() {
        let mini = builtin_price("openai", "gpt-4o-mini").unwrap();
        assert_eq!(mini.model_prefix, "gpt-4o-mini");
        let full = builtin_price("openai", "gpt-4o").unwrap();
        assert_eq!(full.model_prefix, "gpt-4o");
        assert!(mini.input_usd_per_mtok < full.input_usd_per_mtok);
    }

    #[test]
    fn unknown_model_returns_none_rather_than_a_neighbours_price() {
        // 用相近模型的单价冒充等于编数字，UI 宁可显示「无价格信息」。
        assert!(builtin_price("openai", "some-brand-new-model").is_none());
        assert!(builtin_price("no-such-provider", "gpt-4o-mini").is_none());
    }

    #[test]
    fn local_models_are_priced_at_zero_not_missing() {
        // 本机模型确实不产生 API 费用，0 是正确的值。
        let price = builtin_price("ollama", "anything").unwrap();
        assert_eq!(cost_usd(usage(10_000, 10_000), price), 0.0);
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

    /// 「翻译 1,000 句约 $0.04」的推导（PRD §11.2）：gpt-4o-mini、每句 40 输入 + 60 输出 token。
    ///
    /// 官网（公开仓库 youming-ai/umuo）首页收成一屏后已不展示这个费用示例；
    /// 以后放回去时按这里的推导写。牌价一变这条测试就会失败，届时官网文案与这里的常数一起改。
    #[test]
    fn the_website_cost_example_matches_the_price_table() {
        let price = builtin_price("openai", "gpt-4o-mini").expect("gpt-4o-mini 应在价格表里");
        let usage = TokenUsage {
            input_tokens: 40_000,
            output_tokens: 60_000,
            estimated: false,
        };
        let usd = cost_usd(usage, price);
        assert!(
            (usd - 0.042).abs() < 0.0005,
            "费用示例按约 $0.04 写，实际推导为 {usd:.4}——官网若展示了这个示例，要一起更新"
        );
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

    #[test]
    fn monthly_total_only_counts_entries_inside_the_window() {
        let now = 1_700_000_000;
        let entries = vec![
            LedgerEntry {
                at: now - 3600,
                provider_id: "openai".into(),
                model: "gpt-4o-mini".into(),
                usage: usage(1000, 1000),
                cost_usd: 0.001,
            },
            LedgerEntry {
                at: now - 40 * 86_400,
                provider_id: "openai".into(),
                model: "gpt-4o-mini".into(),
                usage: usage(1000, 1000),
                cost_usd: 99.0,
            },
        ];
        assert!((cost_since(&entries, now, 30) - 0.001).abs() < 1e-9);
        assert!(cost_since(&entries, now, 60) > 99.0);
    }

    #[test]
    fn cap_is_only_exceeded_when_one_is_set() {
        assert!(!over_cap(1_000_000.0, None), "没设上限就不该拦");
        assert!(over_cap(5.0, Some(5.0)), "达到上限即视为超出");
        assert!(over_cap(6.0, Some(5.0)));
        assert!(!over_cap(4.99, Some(5.0)));
        assert!(!over_cap(10.0, Some(0.0)), "0 表示不限制，而不是立刻拦下");
    }
}
