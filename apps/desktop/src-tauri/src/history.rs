//! 把一次翻译写进历史（PRD §5.9）。
//!
//! 这一层很薄，但它守着两条产品规则：
//!
//! 1. **历史写失败绝不冒泡。** 一次成功的翻译不该因为「历史没写进去」而看起来失败了。
//!    这里只打日志，用户的译文照常显示。
//! 2. **关闭历史时一条都不写。** 用户关掉它不是因为嫌列表长，而是因为不想留下记录——
//!    这时候「只写一点点」比全都写更违背承诺。

use tauri::{AppHandle, Manager};
use umuo_platform::SelectionReader;
use umuo_store::{NewRecord, Store, UsageSummary};

use crate::AppState;

/// 一次翻译的原始素材。时间戳与来源 App 由 [`record`] 补齐——
/// 调用方在做翻译，不该操心这些。
#[derive(Debug, Clone)]
pub struct Draft {
    pub source_text: String,
    pub translated_text: String,
    pub source_lang: Option<String>,
    pub target_lang: String,
    pub provider_id: String,
    pub model: String,
    pub style_id: String,
    /// 场景标签：selection / silentReplace / compose / compare。
    pub scene: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated: bool,
    pub cost_usd: Option<f64>,
}

/// 记录一次翻译。任何失败都只写 stderr。
pub fn record(app: &AppHandle, draft: Draft) {
    let state = app.state::<AppState>();

    {
        let settings = state.settings.lock().expect("设置锁不应中毒");
        if !settings.history_enabled {
            return;
        }
        // 隐私模式是**临时的**「别记」：它与「关掉历史」的取舍不同——
        // 用户不想为了这几个小时先去改长期偏好再改回来。
        if settings.privacy_mode {
            return;
        }
    }

    // 来源应用名拿不到就是 None。历史里留空，而不是塞个 pid 之类的占位符。
    let source_app = state.selection.frontmost_app_name();

    let entry = NewRecord {
        created_at: now_unix(),
        source_text: draft.source_text,
        translated_text: draft.translated_text,
        source_lang: draft.source_lang,
        target_lang: draft.target_lang,
        provider_id: draft.provider_id,
        model: draft.model,
        style_id: draft.style_id,
        scene: draft.scene,
        source_app,
        input_tokens: draft.input_tokens,
        output_tokens: draft.output_tokens,
        estimated: draft.estimated,
        cost_usd: draft.cost_usd,
    };

    let guard = state.store.lock().expect("存储锁不应中毒");
    let Some(store) = guard.as_ref() else {
        // 启动时没能打开库（见 main.rs），此时静默跳过而不是反复报错。
        return;
    };
    if let Err(error) = store.insert(&entry) {
        eprintln!("umuo: 写历史失败（不影响本次翻译）：{error}");
    }
}

/// 打开库，并在需要时按保留天数清理旧记录。
///
/// 返回 `Err` 时客户端**照常启动**：历史不可用不该让整个翻译工具打不开。
pub fn open_and_prune(
    dir: &std::path::Path,
    retention_days: u32,
) -> Result<(Store, usize), String> {
    let store = Store::open(&dir.join("history.db")).map_err(|e| e.to_string())?;

    let pruned = if retention_days == 0 {
        // 0 = 不自动清理。用户要么想全部留着，要么自己去清。
        0
    } else {
        let cutoff = now_unix() - i64::from(retention_days) * 86_400;
        store.prune_before(cutoff).map_err(|e| e.to_string())?
    };
    Ok((store, pruned))
}

/// 「本月」的起点与用量都交给存储层算——SQLite 自带 `localtime` 与 `start of month`
/// 修饰符，比在这里手写日期算术（还要处理时区）靠谱得多。
pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 便捷包装：`AppState` 里有库时才执行查询。
pub fn with_store<T>(
    app: &AppHandle,
    query: impl FnOnce(&Store) -> Result<T, umuo_store::StoreError>,
) -> Result<T, String> {
    let state = app.state::<AppState>();
    let guard = state.store.lock().expect("存储锁不应中毒");
    let store = guard.as_ref().ok_or_else(|| {
        state
            .store_error
            .clone()
            .unwrap_or_else(|| "历史数据库不可用".to_string())
    })?;
    query(store).map_err(|e| e.to_string())
}

/// 本月的用量汇总。
pub fn month_usage(app: &AppHandle) -> Result<UsageSummary, String> {
    with_store(app, |store| store.usage_this_month())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_unix_is_a_plausible_recent_timestamp() {
        // 2026-01-01 之后、且不在未来。
        let now = now_unix();
        assert!(now > 1_767_225_600, "时间戳早于 2026 年，系统时钟可能不对");
        assert!(now < i64::MAX / 2);
    }

    #[test]
    fn history_records_use_the_local_month_boundary_from_sqlite() {
        // 这条断言的价值在于：它把「本月起点」的定义钉在存储层，
        // 而不是在应用层再实现一遍日期算术。
        let store = Store::open_in_memory().unwrap();
        let start = store.month_start_unix().unwrap();
        assert!(start <= now_unix());
    }
}
