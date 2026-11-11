//! 把一次翻译写进历史（PRD §5.9）。
//!
//! 这一层很薄，但它守着两条产品规则：
//!
//! 1. **历史写失败绝不冒泡。** 一次成功的翻译不该因为「历史没写进去」而看起来失败了。
//!    这里只打日志，用户的译文照常显示。
//! 2. **关闭历史时一条都不写。** 用户关掉它不是因为嫌列表长，而是因为不想留下记录——
//!    这时候「只写一点点」比全都写更违背承诺。
//!
//! 费用报表与月度预算已退出（PRD §5.10），用量账本不再写入；库里的旧账本与历史的
//! `cost_usd` 列原样保留，新记录的费用留空。

use umuo_store::{NewRecord, Store};

use crate::AppCore;

/// 一次翻译的原始素材。时间戳由 [`record`] 补齐。
#[derive(Debug, Clone)]
pub struct Draft {
    pub source_text: String,
    pub translated_text: String,
    pub source_lang: Option<String>,
    pub target_lang: String,
    pub provider_id: String,
    pub model: String,
    pub style_id: String,
    /// 场景标签：selection / silentReplace / compose / ocr / voice（旧库里还可能有 compare）。
    pub scene: String,
    /// 来源应用名，由调用方在**发起时**取一次：翻译要几秒，完成时的前台应用可能已经换了。
    /// 拿不到就是 None，历史里留空，而不是塞个 pid 之类的占位符。
    pub source_app: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated: bool,
}

/// 撰写窗的一次结果：先暂存，等用户提交（[`commit_compose`]）才记。新的一次顶掉旧的。
pub(crate) fn hold_compose(core: &AppCore, request_id: u64, draft: Draft) {
    *core.pending_compose.lock().expect("撰写暂存锁不应中毒") = Some((request_id, draft));
}

/// 撰写窗发出新请求：上一次的暂存作废（截断、出错的这次不会再暂存，免得提交时记成旧的）。
pub(crate) fn forget_compose(core: &AppCore) {
    *core.pending_compose.lock().expect("撰写暂存锁不应中毒") = None;
}

/// 用户提交了撰写窗里 `request_id` 那次的译文：把暂存的那条记进历史。
///
/// id 对不上（提交的不是最近完成的那次）、或已经记过（连按两次提交）就什么都不做。
/// 关闭记录与隐私模式照常由 [`record`] 在提交这一刻判断。
pub fn commit_compose(core: &AppCore, request_id: u64) {
    let held = {
        let mut pending = core.pending_compose.lock().expect("撰写暂存锁不应中毒");
        match pending.as_ref() {
            Some((id, _)) if *id == request_id => pending.take(),
            _ => None,
        }
    };
    if let Some((_, draft)) = held {
        record(core, draft);
    }
}

/// 记录一次翻译进历史。任何失败都只写 stderr。
pub fn record(core: &AppCore, draft: Draft) {
    let created_at = now_unix();

    {
        let settings = core.settings.lock().expect("设置锁不应中毒");
        if !settings.history_enabled {
            return;
        }
        // 隐私模式是**临时的**「别记」：它与「关掉历史」的取舍不同——
        // 用户不想为了这几个小时先去改长期偏好再改回来。
        if settings.privacy_mode {
            return;
        }
    }

    let entry = NewRecord {
        created_at,
        source_text: draft.source_text,
        translated_text: draft.translated_text,
        source_lang: draft.source_lang,
        target_lang: draft.target_lang,
        provider_id: draft.provider_id,
        model: draft.model,
        style_id: draft.style_id,
        scene: draft.scene,
        source_app: draft.source_app,
        input_tokens: draft.input_tokens,
        output_tokens: draft.output_tokens,
        estimated: draft.estimated,
        cost_usd: None,
    };

    let guard = core.store.lock().expect("存储锁不应中毒");
    let Some(store) = guard.as_ref() else {
        // 启动时没能打开库（见 `AppCore::open`），此时静默跳过而不是反复报错。
        return;
    };
    if let Err(error) = store.insert(&entry) {
        eprintln!("umuo: 写历史失败（不影响本次翻译）：{error}");
    }
}

/// 打开库，并在需要时按保留天数清理旧记录。
///
/// 返回 `Err` 时客户端**照常启动**：历史不可用不该让整个翻译工具打不开。
///
/// 库文件损坏时挪成 `history.db.corrupt-<时间戳>` 再建新库——否则用户只能自己去
/// 删文件，而这一整段会话的历史都不可用。清理失败（比如磁盘将满）
/// 只打日志：库本身是好的，不该因为删不掉旧记录就把它整个丢掉。
pub fn open_and_prune(
    dir: &std::path::Path,
    retention_days: u32,
) -> Result<(Store, usize), String> {
    let (store, backup) =
        Store::open_recovering(&dir.join("history.db")).map_err(|e| e.to_string())?;
    if let Some(backup) = backup {
        eprintln!(
            "umuo: 历史数据库已损坏，原文件留在 {}，已新建一个空库",
            backup.display()
        );
    }

    let pruned = prune(&store, retention_days);
    Ok((store, pruned))
}

/// 按保留天数删掉超期的记录，返回删了几条。0 天 = 不自动清理（用户要么想全部留着，要么自己去清）。
///
/// 清理失败（比如磁盘将满）只打日志：库本身是好的，不该因为删不掉旧记录就不能用。
fn prune(store: &Store, retention_days: u32) -> usize {
    if retention_days == 0 {
        return 0;
    }
    let cutoff = now_unix() - i64::from(retention_days) * 86_400;
    store.prune_before(cutoff).unwrap_or_else(|error| {
        eprintln!("umuo: 清理旧历史失败（历史仍可用）：{error}");
        0
    })
}

/// 保存设置后按新的保留天数清理一次：保留期改短了当场生效，不等下次启动。库不可用时什么都不做。
pub fn prune_expired(core: &AppCore, retention_days: u32) {
    let guard = core.store.lock().expect("存储锁不应中毒");
    if let Some(store) = guard.as_ref() {
        prune(store, retention_days);
    }
}

/// 当前 Unix 秒。系统时钟早于 1970 年时为 0。
pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 便捷包装：[`AppCore`] 里有库时才执行查询，没有就返回打开失败的原因。
pub fn with_store<T>(
    core: &AppCore,
    query: impl FnOnce(&Store) -> Result<T, umuo_store::StoreError>,
) -> Result<T, String> {
    let guard = core.store.lock().expect("存储锁不应中毒");
    let store = guard.as_ref().ok_or_else(|| {
        core.store_error
            .clone()
            .unwrap_or_else(|| "历史数据库不可用".to_string())
    })?;
    query(store).map_err(|e| e.to_string())
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
    fn a_corrupt_history_file_is_set_aside_instead_of_disabling_history() {
        let dir = std::env::temp_dir().join(format!("umuo-desktop-corrupt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("history.db"), vec![0x5a_u8; 8192]).unwrap();

        let (store, _) = open_and_prune(&dir, 90).expect("损坏的库应被替换而不是让历史不可用");
        assert_eq!(store.count().unwrap(), 0);
        let backups = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("history.db.corrupt-")
            })
            .count();
        assert_eq!(backups, 1, "原文件应留作备份");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
