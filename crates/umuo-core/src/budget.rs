//! 月度用量上限（PRD §5.10：按 Provider 设月度上限，超限时提醒或自动切换到备用模型）。
//!
//! 这一层只有纯计算：给定「本月已花」与「上限」，判断是否超限、该换成谁。
//! 怎么拿到「已花」是存储层的事，怎么用这个判断是应用层的事——分成三处，
//! 是为了这条规则能在没有数据库、没有网络的情况下被测清楚。
//!
//! 一个刻意的取舍：**没设上限与上限为 0 是两回事**。
//! - `limit_usd: None` = 用户没给这个供应商设上限，永远不拦。
//! - `limit_usd: Some(0.0)` = 用户明确说「这个供应商一分钱也不许花」。
//!
//! 把 0 当成「没设」会让「临时停用某个供应商」这个用法失效
//! （用户只能删掉 Key，而删 Key 会丢掉 Key 本身）。

use serde::{Deserialize, Serialize};

/// 超限之后怎么办（PRD §5.10 的「提醒或自动切换」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LimitAction {
    /// 照常翻译，但在结果里带一条提醒。
    ///
    /// 这是默认值：换供应商意味着译文风格、术语、甚至语言质量都会变，
    /// 用户没有明确同意之前不该悄悄换。
    #[default]
    Warn,
    /// 换成另一个没超限的供应商；一个能用的都没有时退回提醒。
    Failover,
}

/// 某个供应商本月的用量情况。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Budget {
    pub spent_usd: f64,
    /// `None` = 没设上限。
    pub limit_usd: Option<f64>,
}

impl Budget {
    pub fn new(spent_usd: f64, limit_usd: Option<f64>) -> Self {
        Self {
            spent_usd,
            limit_usd,
        }
    }

    /// 没设上限的供应商。
    pub fn unlimited(spent_usd: f64) -> Self {
        Self {
            spent_usd,
            limit_usd: None,
        }
    }

    /// 是否已经花到上限。
    ///
    /// 用 `>=` 而不是 `>`：上限的含义是「最多花这么多」，花到正好等于就该停。
    /// 用 `>` 的话上限 5 美元会在 5.00 时放行、5.000001 时才拦，而这零点几厘
    /// 在实际调用里根本不会出现——用户看到的是「设了 5 块却花了 5.0001」。
    pub fn is_over(&self) -> bool {
        match self.limit_usd {
            Some(limit) => self.spent_usd >= limit,
            None => false,
        }
    }

    /// 还剩多少额度。没设上限时为 `None`。
    pub fn remaining_usd(&self) -> Option<f64> {
        self.limit_usd
            .map(|limit| (limit - self.spent_usd).max(0.0))
    }

    /// 已用比例（0..1）。没设上限、或上限为 0 时为 `None`。
    pub fn used_ratio(&self) -> Option<f64> {
        let limit = self.limit_usd?;
        if limit <= 0.0 {
            return None;
        }
        Some((self.spent_usd / limit).clamp(0.0, 1.0))
    }
}

/// 超限判断的结果，用于生成给用户看的文案。
#[derive(Debug, Clone, PartialEq)]
pub struct LimitVerdict {
    pub provider_id: String,
    pub spent_usd: f64,
    pub limit_usd: f64,
}

impl LimitVerdict {
    /// 提醒文案。说清「花了多少 / 上限多少 / 换成了谁」，
    /// 而不是只说一句「已超出月度上限」让用户自己去翻设置。
    pub fn warning(&self, switched_to: Option<&str>) -> String {
        let base = format!(
            "{} 本月已花 ${:.2}（上限 ${:.2}）",
            self.provider_id, self.spent_usd, self.limit_usd
        );
        match switched_to {
            Some(target) => format!("{base}，本次已改用 {target}"),
            None => format!("{base}，本次仍按原供应商发出"),
        }
    }
}

/// 判断某个供应商是否超限。
pub fn check(provider_id: &str, budget: Budget) -> Option<LimitVerdict> {
    if !budget.is_over() {
        return None;
    }
    Some(LimitVerdict {
        provider_id: provider_id.to_string(),
        spent_usd: budget.spent_usd,
        // `is_over` 为真时一定有上限。
        limit_usd: budget.limit_usd.unwrap_or_default(),
    })
}

/// 一条上限配置（写进 `settings.json`）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLimit {
    pub provider_id: String,
    pub limit_usd: f64,
}

/// 取某个供应商的上限。没配置过 = 不设上限。
///
/// 负数上限按 0 处理（= 不许花钱）：它多半是用户手改配置的笔误，
/// 而按 0 处理是「更保守」的那一侧，不会因为笔误而放行支出。
pub fn limit_for(limits: &[ProviderLimit], provider_id: &str) -> Option<f64> {
    limits
        .iter()
        .find(|limit| limit.provider_id == provider_id)
        .map(|limit| limit.limit_usd.max(0.0))
}

/// 超限之后的决定。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision<'a> {
    /// 照常使用当前供应商。
    Keep,
    /// 换到这个供应商。
    Switch(&'a str),
}

/// 给定候选（按用户偏好排序，通常第一个就是当前供应商）与各自的预算，决定用谁。
///
/// 返回「决定」与「是否需要提醒」。提醒在两种情况下都要给：
/// 真的换了供应商（要让用户知道结果来自别处），以及没换成（要让用户知道超额仍在发生）。
pub fn decide<'a>(
    candidates: &[(&'a str, Budget)],
    current: &str,
    action: LimitAction,
) -> (Decision<'a>, Option<LimitVerdict>) {
    let Some((_, budget)) = candidates.iter().find(|(id, _)| *id == current) else {
        // 候选里没有当前供应商 = 我们拿不到它的用量，不该凭空拦下这次翻译。
        return (Decision::Keep, None);
    };
    let Some(verdict) = check(current, *budget) else {
        return (Decision::Keep, None);
    };

    if action == LimitAction::Warn {
        return (Decision::Keep, Some(verdict));
    }

    // Failover：在被超限的那个之外找第一个还有额度的。
    let alternative = candidates
        .iter()
        .filter(|(id, _)| *id != current)
        .find(|(_, budget)| !budget.is_over())
        .map(|(id, _)| *id);

    match alternative {
        Some(target) => (Decision::Switch(target), Some(verdict)),
        // 一个能用的都没有：照常发出并提醒。留空比超支更糟——
        // 用户按下快捷键是为了拿到译文，不是为了看到一条额度消息。
        None => (Decision::Keep, Some(verdict)),
    }
}

/// 从候选里挑一个**没超限**的，按给定顺序（用户偏好靠前）。
///
/// 都不满足时返回 `None`——调用方据此退回「提醒但照常发出」。
/// 刻意不返回「花得最少的那个」：在全都超限的情况下，
/// 静默挑一个反而把用户的额度约束彻底架空。
pub fn pick_under_budget<'a>(candidates: &[(&'a str, Budget)]) -> Option<&'a str> {
    candidates
        .iter()
        .find(|(_, budget)| !budget.is_over())
        .map(|(id, _)| *id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_limit_means_never_over_however_much_was_spent() {
        let budget = Budget::unlimited(999.0);
        assert!(!budget.is_over());
        assert_eq!(budget.remaining_usd(), None);
        assert_eq!(budget.used_ratio(), None);
    }

    #[test]
    fn hitting_the_limit_exactly_counts_as_over() {
        // 上限的含义是「最多花这么多」。用 `>` 的话设 5 美元会在 5.00 时放行，
        // 用户看到的是「设了 5 块却花了 5.0001」。
        assert!(Budget::new(5.0, Some(5.0)).is_over());
        assert!(!Budget::new(4.99, Some(5.0)).is_over());
    }

    #[test]
    fn a_zero_limit_means_spend_nothing_not_unlimited() {
        // 把 0 当成「没设上限」会让「临时停用这个供应商」失效——
        // 用户只能删掉 Key，而删 Key 会丢掉 Key 本身。
        let budget = Budget::new(0.0, Some(0.0));
        assert!(budget.is_over(), "0 额度应当一开始就超限");
        assert_eq!(budget.used_ratio(), None, "上限为 0 时算不出有意义的比例");
    }

    #[test]
    fn remaining_never_goes_negative() {
        assert_eq!(Budget::new(7.0, Some(5.0)).remaining_usd(), Some(0.0));
        assert_eq!(Budget::new(1.0, Some(5.0)).remaining_usd(), Some(4.0));
    }

    #[test]
    fn used_ratio_is_clamped_for_the_progress_bar() {
        // 超支时比例大于 1，直接拿去画进度条会溢出容器。
        assert_eq!(Budget::new(10.0, Some(5.0)).used_ratio(), Some(1.0));
        assert_eq!(Budget::new(2.5, Some(5.0)).used_ratio(), Some(0.5));
    }

    #[test]
    fn check_reports_nothing_when_under_the_limit() {
        assert!(check("openai", Budget::new(1.0, Some(5.0))).is_none());
        assert!(check("openai", Budget::unlimited(100.0)).is_none());
    }

    #[test]
    fn check_carries_the_numbers_needed_for_a_useful_warning() {
        let verdict = check("openai", Budget::new(6.5, Some(5.0))).unwrap();
        assert_eq!(verdict.provider_id, "openai");
        assert_eq!(verdict.spent_usd, 6.5);
        assert_eq!(verdict.limit_usd, 5.0);
    }

    #[test]
    fn the_warning_says_what_was_spent_and_whether_anything_changed() {
        let verdict = check("openai", Budget::new(6.5, Some(5.0))).unwrap();
        let switched = verdict.warning(Some("deepseek"));
        assert!(switched.contains("6.50"), "要报出花了多少：{switched}");
        assert!(switched.contains("5.00"), "要报出上限：{switched}");
        assert!(switched.contains("deepseek"), "要说清换成了谁：{switched}");

        let stayed = verdict.warning(None);
        assert!(
            stayed.contains("仍按原供应商"),
            "没换成功时不能含糊：{stayed}"
        );
    }

    #[test]
    fn failover_picks_the_first_candidate_that_still_has_room() {
        let candidates = [
            ("openai", Budget::new(6.5, Some(5.0))),
            ("deepseek", Budget::unlimited(0.0)),
            ("anthropic", Budget::new(0.0, Some(5.0))),
        ];
        assert_eq!(pick_under_budget(&candidates), Some("deepseek"));
    }

    #[test]
    fn failover_returns_none_when_every_candidate_is_over() {
        // 不静默挑「花得最少的那个」：那等于把用户的额度约束彻底架空。
        let candidates = [
            ("openai", Budget::new(6.5, Some(5.0))),
            ("deepseek", Budget::new(1.0, Some(1.0))),
        ];
        assert_eq!(pick_under_budget(&candidates), None);
    }

    #[test]
    fn a_provider_with_a_zero_limit_is_never_chosen_for_failover() {
        // 「临时停用」的语义：它不该被当成一个可用的备用。
        let candidates = [("disabled", Budget::new(0.0, Some(0.0)))];
        assert_eq!(pick_under_budget(&candidates), None);
    }

    #[test]
    fn a_provider_without_a_limit_is_kept_without_any_notice() {
        let candidates = [("openai", Budget::unlimited(50.0))];
        assert_eq!(
            decide(&candidates, "openai", LimitAction::Failover),
            (Decision::Keep, None)
        );
    }

    #[test]
    fn over_the_limit_with_warn_keeps_the_provider_and_explains_why() {
        let candidates = [("openai", Budget::new(6.0, Some(5.0)))];
        let (decision, verdict) = decide(&candidates, "openai", LimitAction::Warn);
        assert_eq!(decision, Decision::Keep);
        assert_eq!(verdict.unwrap().spent_usd, 6.0);
    }

    #[test]
    fn over_the_limit_with_failover_switches_to_the_next_usable_provider() {
        let candidates = [
            ("openai", Budget::new(6.0, Some(5.0))),
            ("deepseek", Budget::new(0.5, Some(5.0))),
        ];
        let (decision, verdict) = decide(&candidates, "openai", LimitAction::Failover);
        assert_eq!(decision, Decision::Switch("deepseek"));
        assert!(verdict.is_some(), "换过了也要提醒，用户该知道结果来自别处");
    }

    #[test]
    fn failover_never_switches_to_another_provider_that_is_also_over() {
        let candidates = [
            ("openai", Budget::new(6.0, Some(5.0))),
            ("deepseek", Budget::new(9.0, Some(5.0))),
        ];
        let (decision, verdict) = decide(&candidates, "openai", LimitAction::Failover);
        assert_eq!(decision, Decision::Keep, "换个也超限的等于没换");
        assert!(verdict.is_some(), "没换成也要提醒：超额支出仍在发生");
    }

    #[test]
    fn switching_to_a_provider_that_is_not_in_the_candidate_list_never_happens() {
        // 候选清单是「用户配了 Key 且能用的那些」，切换只在这份清单内部发生。
        let candidates = [("openai", Budget::new(6.0, Some(5.0)))];
        let (decision, _) = decide(&candidates, "openai", LimitAction::Failover);
        assert_eq!(decision, Decision::Keep);
    }

    #[test]
    fn an_unknown_current_provider_is_kept_rather_than_blocked() {
        // 拿不到用量就凭空拦下翻译，是最糟的失败方式。
        let candidates = [("deepseek", Budget::unlimited(0.0))];
        let (decision, verdict) = decide(&candidates, "openai", LimitAction::Failover);
        assert_eq!(decision, Decision::Keep);
        assert!(verdict.is_none());
    }

    #[test]
    fn a_negative_configured_limit_is_treated_as_zero() {
        // 多半是手改配置的笔误。按 0 处理是更保守的那一侧，不会因笔误而放行支出。
        let limits = vec![ProviderLimit {
            provider_id: "openai".to_string(),
            limit_usd: -10.0,
        }];
        assert_eq!(limit_for(&limits, "openai"), Some(0.0));
        assert!(Budget::new(0.0, limit_for(&limits, "openai")).is_over());
    }

    #[test]
    fn a_provider_missing_from_the_limit_list_is_unlimited() {
        let limits = vec![ProviderLimit {
            provider_id: "openai".to_string(),
            limit_usd: 5.0,
        }];
        assert_eq!(limit_for(&limits, "deepseek"), None);
    }

    #[test]
    fn the_default_action_is_warn_not_silent_switching() {
        // 换供应商会改变译文风格、术语甚至质量，用户没明确同意之前不该悄悄换。
        assert_eq!(LimitAction::default(), LimitAction::Warn);
    }
}
