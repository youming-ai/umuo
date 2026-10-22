//! 月度上限的执行点（PRD §5.10）。
//!
//! 判断逻辑全在 [`umuo_core::budget`] 里（纯函数、有测试）。这里只做三件事：
//! 从用量账本取「本月花了多少」、拼出候选供应商清单、按决定换人。
//!
//! 一条贯穿始终的原则：**上限是约束，不是路障**。任何一步拿不到数据
//! （历史库打不开、Key 状态读不到）都按「不拦」处理——用户按下快捷键
//! 是为了拿到译文，不是为了看一条额度消息。

use umuo_core::budget::{self, Budget, Decision, LimitAction};
use umuo_core::provider::PROVIDERS;

use crate::settings::Settings;
use crate::AppCore;

/// 本次请求实际要用哪个供应商，以及要带给用户的提醒。
pub struct Resolution {
    pub provider_id: String,
    /// 要显示给用户的提醒（超限了、换人了）。`None` = 无事发生。
    pub warning: Option<String>,
}

/// 解析本次请求该用哪个供应商。
///
/// 按代价从低到高逐步判断：没给当前供应商设上限就直接放行（不查库、不读 Keychain）；
/// 没超限也直接放行；只有超限且设成「自动切换」时才去读其它供应商的 Key——
/// 每读一个 Key 都可能让 macOS 弹一次授权框，不该为每次翻译都付这个代价。
pub fn resolve(core: &AppCore, settings: &Settings, current: &str) -> Resolution {
    let keep = |warning| Resolution {
        provider_id: current.to_string(),
        warning,
    };

    let Some(provider) = PROVIDERS.iter().find(|p| p.id == current) else {
        return keep(None);
    };
    let Some(limit) = budget::limit_for(&settings.monthly_limits, provider.id) else {
        return keep(None);
    };

    // 用量账本不可用时不拦。
    let Ok(spends) = crate::history::with_store(core, |store| {
        store.usage_by_provider(store.month_start_unix()?)
    }) else {
        return keep(None);
    };
    let spend_of = |id: &str| {
        spends
            .iter()
            .find(|row| row.provider_id == id)
            .map(|row| row.cost_usd)
            .unwrap_or(0.0)
    };

    let own = Budget::new(spend_of(provider.id), Some(limit));
    if !own.is_over() {
        return keep(None);
    }

    // 候选清单：当前供应商排最前（它是用户自己的偏好），其余按目录顺序。
    let mut candidates = vec![(provider.id, own)];
    if settings.limit_action == LimitAction::Failover {
        candidates.extend(alternatives(core, settings, current, spend_of));
    }

    let (decision, verdict) = budget::decide(&candidates, current, settings.limit_action);
    let Some(verdict) = verdict else {
        return keep(None);
    };

    match decision {
        Decision::Keep => keep(Some(verdict.warning(None))),
        Decision::Switch(target) => Resolution {
            provider_id: target.to_string(),
            warning: Some(verdict.warning(Some(target))),
        },
    }
}

/// 除当前供应商之外「这次真能用」的供应商及其本月预算，按目录顺序。
fn alternatives(
    core: &AppCore,
    settings: &Settings,
    current: &str,
    spend_of: impl Fn(&str) -> f64,
) -> Vec<(&'static str, Budget)> {
    let mut list: Vec<(&'static str, Budget)> = Vec::new();

    for provider in PROVIDERS {
        if provider.id == current {
            continue;
        }
        // 本地供应商没有默认模型，切过去只会立刻失败，不如留在原地并提醒。
        if !usable_without_model(provider) {
            continue;
        }
        let has_key = core
            .host
            .api_key(provider.id)
            .ok()
            .flatten()
            .is_some_and(|key| !key.trim().is_empty());
        if !has_key {
            continue;
        }
        list.push((
            provider.id,
            Budget::new(
                spend_of(provider.id),
                budget::limit_for(&settings.monthly_limits, provider.id),
            ),
        ));
    }

    list
}

/// 不填模型也能用的供应商（有默认模型）。
fn usable_without_model(provider: &umuo_core::provider::Provider) -> bool {
    !provider.default_model.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use umuo_core::provider::find_provider;

    #[test]
    fn local_providers_are_not_failover_candidates() {
        // 它们没有默认模型，切过去只会立刻失败——那比留在原地并提醒更糟。
        let ollama = find_provider("ollama").unwrap();
        assert!(!usable_without_model(ollama));
        let openai = find_provider("openai").unwrap();
        assert!(usable_without_model(openai));
    }
}
