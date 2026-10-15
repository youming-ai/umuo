//! 月度上限的执行点（PRD §5.10）。
//!
//! 判断逻辑全在 [`umuo_core::budget`] 里（纯函数、有测试）。这里只做三件事：
//! 从历史库取「本月花了多少」、拼出候选供应商清单、按决定换人。
//!
//! 一条贯穿始终的原则：**上限是约束，不是路障**。任何一步拿不到数据
//! （历史库打不开、Key 状态读不到）都按「不拦」处理——用户按下快捷键
//! 是为了拿到译文，不是为了看一条额度消息。

use tauri::{AppHandle, Manager};
use umuo_core::budget::{self, Budget, Decision};
use umuo_core::provider::PROVIDERS;
use umuo_platform::SecretStore;

use crate::settings::Settings;
use crate::AppState;

/// 本次请求实际要用哪个供应商，以及要带给用户的提醒。
pub struct Resolution {
    pub provider_id: String,
    /// 要显示给用户的提醒（超限了、换人了）。`None` = 无事发生。
    pub warning: Option<String>,
}

/// 解析本次请求该用哪个供应商。
pub fn resolve(app: &AppHandle, settings: &Settings, current: &str) -> Resolution {
    let keep = |warning| Resolution {
        provider_id: current.to_string(),
        warning,
    };

    // 候选清单：当前供应商排最前（它是用户自己的偏好），其余按目录顺序。
    // 只收「这次真能用」的：本地供应商没有默认模型，切过去只会立刻失败。
    let candidates = match candidates(app, settings, current) {
        Some(list) => list,
        None => return keep(None),
    };

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

/// 拼出「这次能用」的供应商及其本月预算，当前供应商排最前。
fn candidates(
    app: &AppHandle,
    settings: &Settings,
    current: &str,
) -> Option<Vec<(&'static str, Budget)>> {
    // 历史库不可用时不拦（返回 None 表示「拿不到用量」）。
    let spends = crate::history::with_store(app, |store| {
        store.usage_by_provider(store.month_start_unix()?)
    })
    .ok()?;
    let state = app.state::<AppState>();

    let spend_of = |id: &str| {
        spends
            .iter()
            .find(|row| row.provider_id == id)
            .map(|row| row.cost_usd)
            .unwrap_or(0.0)
    };

    let mut list: Vec<(&'static str, Budget)> = Vec::new();

    // 当前供应商先放进去：即使它没配 Key（比如刚删掉），也要能查到它的预算，
    // 否则 `decide` 会因为「候选里没有当前供应商」而直接放行。
    if let Some(provider) = PROVIDERS.iter().find(|p| p.id == current) {
        list.push((
            provider.id,
            Budget::new(
                spend_of(provider.id),
                budget::limit_for(&settings.monthly_limits, provider.id),
            ),
        ));
    }

    for provider in PROVIDERS {
        if provider.id == current {
            continue;
        }
        // 本地供应商没有默认模型，切过去只会立刻失败，不如留在原地并提醒。
        if !usable_without_model(provider) {
            continue;
        }
        let has_key = state
            .secrets
            .get(provider.id)
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

    Some(list)
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
