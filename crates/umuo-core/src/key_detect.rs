//! 按 Key 前缀推测供应商（PRD §6.2 第 2 步）。
//!
//! 这是个**建议器**，不是校验器。前缀只能收窄候选集，不能唯一确定：
//! DeepSeek、通义、Moonshot 的 Key 都是 `sk-` 开头，与 OpenAI 无法区分。
//! 所以返回的是一个**有序候选列表**，UI 把它作为下拉框的默认选中项，
//! 用户随时可以改——PRD 原文也是这么写的（「用户可手动更正」）。

use crate::provider::{Provider, PROVIDERS};

/// 一个候选供应商，附带为什么被选中的理由（用于 UI 上解释自动选择）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Candidate {
    pub provider: &'static Provider,
    /// 命中的前缀长度。越长判别力越强，排序依据。
    pub matched_prefix_len: usize,
}

/// 按 Key 推测候选供应商，判别力强的在前。
///
/// 没有任何前缀命中时**返回空列表**，而不是把所有供应商倒出来：让 UI 展示
/// 「未能识别，请手动选择」，比让用户在一个 11 项的下拉框里猜要好。
pub fn infer_providers(api_key: &str) -> Vec<Candidate> {
    let key = api_key.trim();
    if key.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<Candidate> = PROVIDERS
        .iter()
        .filter(|p| p.kind == crate::provider::ProviderKind::Cloud)
        .filter_map(|p| {
            let best = p
                .key_prefixes
                .iter()
                .filter(|prefix| key.starts_with(**prefix))
                .map(|prefix| prefix.len())
                .max()?;
            Some(Candidate {
                provider: p,
                matched_prefix_len: best,
            })
        })
        .collect();

    // 只保留**最长命中**的那些候选。理由：前缀是有层级的——
    // `sk-ant-api03-…` 同时命中了 anthropic 的 `sk-ant-` 和 openai 的通用 `sk-`，
    // 但后者显然只是兜底。若把兜底项也留下，用户会看到 5 个候选，
    // 「自动识别」就退化成了「让用户自己选」。
    let Some(best) = out.iter().map(|c| c.matched_prefix_len).max() else {
        // 一个候选都没有：让 UI 去问用户，而不是猜。
        return out;
    };
    out.retain(|c| c.matched_prefix_len == best);

    // 同长度时保持目录顺序，让「OpenAI」稳定排在「DeepSeek」前面——
    // 默认项的稳定性会影响肌肉记忆。
    out
}

/// 最可能的那一个。没有候选时返回 `None`。
pub fn infer_provider(api_key: &str) -> Option<&'static Provider> {
    infer_providers(api_key).first().map(|c| c.provider)
}

/// 这个 Key 形状像不像「本机模型不需要 Key」的情形——空 Key 时给 UI 的提示用。
pub fn looks_like_missing_key(api_key: &str) -> bool {
    api_key.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_prefix_is_unambiguous() {
        let candidates = infer_providers("sk-ant-api03-abcdef");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].provider.id, "anthropic");
        // sk-ant- 有 7 个字符，判别力强于任何 sk- 前缀。
        assert_eq!(candidates[0].matched_prefix_len, 7);
    }

    #[test]
    fn gemini_prefix_maps_to_gemini() {
        assert_eq!(infer_provider("AIzaSyD-1234567890").unwrap().id, "gemini");
    }

    #[test]
    fn openrouter_beats_the_generic_sk_prefix() {
        // sk-or- 与 sk- 同时命中，必须由更长的那个胜出。
        let candidates = infer_providers("sk-or-v1-abcdef");
        assert_eq!(candidates[0].provider.id, "openrouter");
    }

    #[test]
    fn ambiguous_sk_keys_return_multiple_candidates_not_a_silent_guess() {
        let candidates = infer_providers("sk-abcdef123456");
        let ids: Vec<&str> = candidates.iter().map(|c| c.provider.id).collect();
        assert!(ids.contains(&"openai"), "应包含 OpenAI，实际 {ids:?}");
        assert!(ids.contains(&"deepseek"), "应包含 DeepSeek，实际 {ids:?}");
        assert!(candidates.len() > 1, "sk- 前缀本就不可能唯一确定供应商");
    }

    #[test]
    fn unknown_shape_yields_no_candidate_so_ui_asks_the_user() {
        assert!(infer_providers("some-random-token").is_empty());
        assert!(infer_provider("zhipu-style-id.secret").is_none());
    }

    #[test]
    fn empty_or_whitespace_key_is_not_a_candidate() {
        assert!(infer_providers("").is_empty());
        assert!(infer_providers("   ").is_empty());
        assert!(looks_like_missing_key("  "));
    }

    #[test]
    fn local_providers_never_appear_as_key_candidates() {
        // 本机模型不需要 Key，出现在「粘贴 Key 自动识别」的结果里只会让人困惑。
        for candidates in [infer_providers("sk-abc"), infer_providers("AIzaXYZ")] {
            for c in candidates {
                assert_ne!(c.provider.kind, crate::provider::ProviderKind::Local);
            }
        }
    }
}
