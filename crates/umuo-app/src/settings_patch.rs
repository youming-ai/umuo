//! 设置的写入：把一份 JSON 顶层 patch 叠在**最新**的设置上，校验通过才落盘（迁移计划 §5.4）。
//!
//! Swift 保存队列经 FFI 每次只交自己改的键。规则：
//!
//! 1. **先看文件有没有被别人改过**：mtime 与上次读写时记下的不同就先重载——
//!    外部修改配置时，缩小互相覆盖的窗口。重载逐字段容错：个别字段类型不对的沿用当前值，
//!    用户手改的其余内容照样生效；有字段读不懂、或整份读不动沿用内存值时，**真要写盘前**
//!    先把原文复制一份 `.corrupt-<时间戳>`——这次保存会覆盖它，手改的原文必须找得回来。
//!    复制失败就拒绝保存。**不走** `load_or_backup`：那条路会把文件挪走并回落默认值，
//!    保存途中这么做等于清空用户的配置。
//! 2. **顶层逐键覆盖**，嵌套对象整体替换、不做深合并。
//! 3. 失败（patch 解析不了、`prepare_for_save` 不通过、写盘失败）时**内存和文件都不变**。

use std::path::Path;

use serde::Deserialize;
use std::time::SystemTime;

use crate::settings::Settings;
use crate::AppCore;

/// 一次保存之后宿主要做的事。
///
/// 只返回需要宿主按条件执行的快捷键重注册；主题与外观由 Swift 应用设置。
/// 改代理仍要重启（见 `AppCore::open`），所以这里没有「重建 HTTP 客户端」。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SettingsEffects {
    /// 快捷键改了：宿主要当场重注册，不用重启客户端。
    pub hotkeys: bool,
}

impl AppCore {
    /// 把 `patch`（JSON 对象）的顶层键叠在最新设置上，规范化、校验、落盘，返回**规范化之后**的设置。
    ///
    /// 校验、写盘、换内存都在设置锁里：与「按 App 记住目标语言」的写入串行，谁也不会拿旧值盖掉对方。
    pub fn apply_settings_patch(
        &self,
        patch: serde_json::Value,
    ) -> Result<(Settings, SettingsEffects), String> {
        self.apply_settings_patch_with(patch, || Ok(|| ()))
    }

    /// 同 [`Self::apply_settings_patch`]，但在校验通过之后、设置落盘之前先执行 `before_save`。
    ///
    /// 导入配置用它写术语表：设置校验不通过时 `before_save` 根本不会被调用，
    /// 满足「不合法就一个文件都不写」；`before_save` 失败时设置同样不落盘、内存不变。
    /// `before_save` 成功时返回一个回滚动作：设置写盘失败（磁盘满、权限）就在设置锁里执行它，
    /// 把 `before_save` 写过的东西恢复原样，再返回错误——要么都写成，要么都不写。
    pub(crate) fn apply_settings_patch_with<Rollback: FnOnce()>(
        &self,
        patch: serde_json::Value,
        before_save: impl FnOnce() -> Result<Rollback, String>,
    ) -> Result<(Settings, SettingsEffects), String> {
        let serde_json::Value::Object(patch) = patch else {
            return Err("设置的改动必须是一个 JSON 对象".to_string());
        };
        let mut current = self.settings.lock().expect("设置锁不应中毒");
        let mut mtime = self.settings_mtime.lock().expect("设置时间戳锁不应中毒");

        let path = Settings::path_in(&self.config_dir);
        let Latest {
            settings: latest,
            backup,
        } = latest_settings(&path, &current, *mtime);

        let mut merged = serde_json::to_value(&latest).expect("设置结构体一定可序列化");
        let fields = merged.as_object_mut().expect("设置序列化成 JSON 对象");
        for (key, value) in patch {
            fields.insert(key, value);
        }
        let mut next: Settings =
            serde_json::from_value(merged).map_err(|e| format!("设置格式不对：{e}"))?;
        next.prepare_for_save(&latest)?;
        if backup {
            keep_aside(&path)?;
        }
        let rollback = before_save()?;
        if let Err(error) = next.save(&self.config_dir) {
            rollback();
            return Err(error.to_string());
        }

        // 与内存里的旧值比：宿主注册着的是它，不是刚从文件重载的那份。
        let effects = SettingsEffects {
            hotkeys: current.hotkeys() != next.hotkeys(),
        };
        *mtime = modified(&path);
        *current = next.clone();
        drop((current, mtime));
        // 保留期改短了要当场生效，不等下次启动；没改也只是一次便宜的删除。
        crate::history::prune_expired(self, next.history_retention_days);
        Ok((next, effects))
    }

    /// 程序内对设置的一次小改动（按 App 记住目标语言）：同样先看文件有没有被别处改过，
    /// 在**最新**设置上执行 `change`，它返回 `true` 才落盘并换进内存。
    ///
    /// 不走 `prepare_for_save`：改动来自程序自身，不是用户填的端点或代理。
    /// 写盘失败时内存与文件都不变，返回 `false`——存不下只是下次还得再选一次。
    pub(crate) fn update_settings(&self, change: impl FnOnce(&mut Settings) -> bool) -> bool {
        let mut current = self.settings.lock().expect("设置锁不应中毒");
        let mut mtime = self.settings_mtime.lock().expect("设置时间戳锁不应中毒");
        let path = Settings::path_in(&self.config_dir);
        let Latest {
            settings: mut next,
            backup,
        } = latest_settings(&path, &current, *mtime);
        if !change(&mut next) || (backup && keep_aside(&path).is_err()) {
            return false;
        }
        if next.save(&self.config_dir).is_err() {
            return false;
        }
        *mtime = modified(&path);
        *current = next;
        true
    }
}

/// 重载的结果：最新设置，以及写盘前要不要先备份原文。
struct Latest {
    settings: Settings,
    /// 文件被外部改过、且有读不懂的内容：这次保存会盖掉它，写盘**之前**先复制一份。
    /// 不在重载时就备份——校验不通过、没有改动时根本不写，重试一次就多一份备份。
    backup: bool,
}

/// 别处改过文件（mtime 与上次读写时不同）就以文件为准；文件没了沿用内存。
///
/// 逐字段容错：整份解析得了就照用；解析不了时，读得懂的顶层键用文件里的，
/// 类型不对的键沿用**内存里的当前值**（不是默认值：保留期回落成默认会当场清掉历史，
/// 黑名单回落成默认会让排除过的应用又能取词），并要求写盘前备份原文。
/// 整份读不动、不是 JSON 对象时沿用内存，同样要求备份。
fn latest_settings(path: &Path, current: &Settings, mtime: Option<SystemTime>) -> Latest {
    let keep = |backup| Latest {
        settings: current.clone(),
        backup,
    };
    if modified(path) == mtime {
        return keep(false);
    }
    let raw = match std::fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return keep(false),
        Err(_) => return keep(true),
    };
    let Ok(serde_json::Value::Object(fields)) = serde_json::from_slice(&raw) else {
        return keep(true);
    };
    if let Ok(settings) = Settings::deserialize(&fields) {
        return Latest {
            settings,
            backup: false,
        };
    }
    let serde_json::Value::Object(live) =
        serde_json::to_value(current).expect("设置结构体一定可序列化")
    else {
        unreachable!("设置序列化成 JSON 对象");
    };
    let merged: serde_json::Map<_, _> = fields
        .into_iter()
        .map(|(key, value)| {
            let single = serde_json::json!({ key.as_str(): value });
            if serde_json::from_value::<Settings>(single).is_ok() {
                (key, value)
            } else {
                let fallback = live.get(&key).cloned().unwrap_or(serde_json::Value::Null);
                (key, fallback)
            }
        })
        .filter(|(_, value)| !value.is_null())
        .collect();
    Latest {
        settings: serde_json::from_value(serde_json::Value::Object(merged))
            .unwrap_or_else(|_| current.clone()),
        backup: true,
    }
}

/// 覆盖前把外部改过的原文复制一份；复制不了就不让保存把它盖掉。
fn keep_aside(path: &Path) -> Result<(), String> {
    crate::persist::copy_aside(path).map_err(|e| {
        format!("设置文件被外部改过且有内容读不懂，备份原文失败（{e}），这次没有保存，以免覆盖手改的内容")
    })
}

/// 设置文件的修改时间；文件不存在或系统不给就是 `None`。
pub(crate) fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use serde_json::json;

    use super::*;
    use crate::host::{FocusSource, Host};

    struct NoHost;

    impl Host for NoHost {
        fn api_key(&self, _: &str) -> Result<Option<String>, String> {
            Ok(None)
        }
        fn frontmost_app_name(&self) -> Option<String> {
            None
        }
        fn frontmost_app_token(&self) -> Option<String> {
            None
        }
        fn write_back(&self, _: FocusSource, _: &str, _: &str) -> Result<(), String> {
            unreachable!("设置测试不写回")
        }
    }

    fn open_in(name: &str, initial: &serde_json::Value) -> AppCore {
        let dir = std::env::temp_dir().join(format!(
            "umuo-app-settings-patch-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), initial.to_string()).unwrap();
        AppCore::open(dir, Arc::new(NoHost)).unwrap()
    }

    fn file_bytes(core: &AppCore) -> Vec<u8> {
        std::fs::read(Settings::path_in(&core.config_dir)).unwrap()
    }

    fn edit_elsewhere(core: &AppCore, contents: &str) {
        let path = Settings::path_in(&core.config_dir);
        std::fs::write(&path, contents).unwrap();
        let later = modified(&path).unwrap() + Duration::from_secs(2);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();
    }

    #[test]
    fn nothing_written_means_no_backup_however_often_it_is_retried() {
        // 备份只在真要写盘时做：校验不通过、程序内小改动没改什么，都不该每试一次多一份。
        let core = open_in("reload-no-write", &json!({ "theme": "light" }));
        edit_elsewhere(
            &core,
            r#"{ "theme": "dark", "historyRetentionDays": "90" }"#,
        );
        for _ in 0..3 {
            assert!(core
                .apply_settings_patch(json!({ "proxyMode": "custom", "proxyUrl": "not a url" }))
                .is_err());
            assert!(!core.update_settings(|_| false));
        }
        assert!(crate::persist::corrupt_backups(&core.config_dir, "settings.json").is_empty());

        core.apply_settings_patch(json!({ "locale": "ja" }))
            .unwrap();
        assert_eq!(
            crate::persist::corrupt_backups(&core.config_dir, "settings.json").len(),
            1,
            "真正写盘时备份一次"
        );
    }

    #[test]
    fn a_failed_validation_leaves_memory_and_file_unchanged() {
        let core = open_in("invalid", &json!({ "theme": "light" }));
        let memory = core.settings.lock().unwrap().clone();
        let bytes = file_bytes(&core);

        let error = core
            .apply_settings_patch(
                json!({ "theme": "dark", "proxyMode": "custom", "proxyUrl": "not a url" }),
            )
            .unwrap_err();
        assert!(!error.is_empty());
        assert_eq!(*core.settings.lock().unwrap(), memory, "内存不变");
        assert_eq!(file_bytes(&core), bytes, "文件不变");
    }

    #[test]
    fn saving_a_shorter_retention_prunes_history_right_away() {
        // 保留期不能只在启动时生效：用户把 90 天改成 30 天，超期的记录当场就该清掉。
        let core = open_in("retention", &json!({}));
        let old = umuo_store::NewRecord {
            created_at: crate::history::now_unix() - 40 * 86_400,
            source_text: "old".into(),
            translated_text: "旧".into(),
            source_lang: None,
            target_lang: "zh-CN".into(),
            provider_id: "openai".into(),
            model: "m".into(),
            style_id: "standard".into(),
            scene: "selection".into(),
            source_app: None,
            input_tokens: 0,
            output_tokens: 0,
            estimated: false,
            cost_usd: None,
        };
        crate::history::with_store(&core, |store| store.insert(&old)).unwrap();

        core.apply_settings_patch(json!({ "historyRetentionDays": 30 }))
            .unwrap();
        assert_eq!(
            crate::history::with_store(&core, |store| store.count()).unwrap(),
            0
        );
    }

    #[test]
    fn a_patch_that_does_not_parse_leaves_memory_and_file_unchanged() {
        let core = open_in("bad-type", &json!({ "theme": "light" }));
        let memory = core.settings.lock().unwrap().clone();
        let bytes = file_bytes(&core);

        assert!(core
            .apply_settings_patch(json!({ "uiScale": "big" }))
            .is_err());
        assert!(
            core.apply_settings_patch(json!(["theme"])).is_err(),
            "不是对象"
        );
        assert_eq!(*core.settings.lock().unwrap(), memory);
        assert_eq!(file_bytes(&core), bytes);
    }

    #[test]
    fn a_patch_only_overwrites_the_keys_it_gives() {
        let core = open_in(
            "partial",
            &json!({ "theme": "light", "locale": "ja", "targetLang": "ko", "futureField": { "x": [1, 2] } }),
        );
        let before = core.settings.lock().unwrap().clone();

        let (saved, _) = core
            .apply_settings_patch(json!({ "theme": "dark", "anotherFuture": 1 }))
            .unwrap();
        assert_eq!(saved.theme, "dark");
        let expected = Settings {
            theme: "dark".into(),
            extra: {
                let mut extra = before.extra.clone();
                extra.insert("anotherFuture".into(), json!(1));
                extra
            },
            ..before
        };
        assert_eq!(saved, expected, "其余键（含未知字段）原样保留");
        assert_eq!(*core.settings.lock().unwrap(), expected, "内存换成新值");
        assert_eq!(Settings::load(&core.config_dir), expected, "文件换成新值");
    }

    #[test]
    fn nested_objects_are_replaced_whole_not_deep_merged() {
        let core = open_in(
            "nested",
            &json!({ "providerBaseUrls": { "openai": "https://a.example", "deepseek": "https://b.example" } }),
        );
        let (saved, _) = core
            .apply_settings_patch(json!({ "providerBaseUrls": { "openai": "https://a.example" } }))
            .unwrap();
        assert_eq!(
            saved.provider_base_urls.len(),
            1,
            "providerBaseUrls 整体替换，不按键合并"
        );
    }

    #[test]
    fn a_file_changed_elsewhere_is_reloaded_before_the_patch() {
        let core = open_in("reload", &json!({ "theme": "light", "locale": "en" }));
        let path = Settings::path_in(&core.config_dir);
        // 另一个客户端改了主题；把 mtime 往后拨，不赌文件系统的时间精度。
        std::fs::write(
            &path,
            json!({ "theme": "dark", "locale": "en" }).to_string(),
        )
        .unwrap();
        let later = modified(&path).unwrap() + Duration::from_secs(2);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();

        let (saved, _) = core
            .apply_settings_patch(json!({ "locale": "ja" }))
            .unwrap();
        assert_eq!(saved.theme, "dark", "别处写进来的值不被旧内存盖掉");
        assert_eq!(saved.locale, "ja");
    }

    #[test]
    fn an_unreadable_file_on_reload_falls_back_to_memory_instead_of_defaults() {
        let core = open_in("reload-corrupt", &json!({ "theme": "dark" }));
        let path = Settings::path_in(&core.config_dir);
        std::fs::write(&path, "{ 半截").unwrap();
        let later = modified(&path).unwrap() + Duration::from_secs(2);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();

        let (saved, _) = core
            .apply_settings_patch(json!({ "locale": "ja" }))
            .unwrap();
        assert_eq!(saved.theme, "dark", "坏文件不能让设置回落成默认值");
        let backups = crate::persist::corrupt_backups(&core.config_dir, "settings.json");
        assert_eq!(backups.len(), 1, "这次保存会盖掉手改的原文，先备份");
        assert_eq!(std::fs::read_to_string(&backups[0]).unwrap(), "{ 半截");
    }

    #[test]
    fn a_hand_edit_with_one_bad_field_keeps_the_other_edits_and_backs_up_the_original() {
        // 手改时把 historyRetentionDays 写成了字符串：以前整份重载失败、退回内存，
        // 这次保存就把同时改的主题、语言一起盖掉。现在只丢那一个字段，原文另存一份。
        let core = open_in(
            "reload-one-bad",
            &json!({ "theme": "light", "locale": "en", "historyRetentionDays": 30 }),
        );
        let path = Settings::path_in(&core.config_dir);
        let edited = json!({ "theme": "dark", "locale": "en", "targetLang": "ja", "historyRetentionDays": "90" })
            .to_string();
        std::fs::write(&path, &edited).unwrap();
        let later = modified(&path).unwrap() + Duration::from_secs(2);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();

        let (saved, _) = core
            .apply_settings_patch(json!({ "locale": "ja" }))
            .unwrap();
        assert_eq!(saved.theme, "dark", "手改的主题保留");
        assert_eq!(saved.target_lang, "ja", "手改的目标语言保留");
        assert_eq!(saved.locale, "ja");
        assert_eq!(
            saved.history_retention_days, 30,
            "类型不对的字段沿用当前值，不回落默认值（默认 90 天以外的值会被改掉、当场清历史）"
        );
        let backups = crate::persist::corrupt_backups(&core.config_dir, "settings.json");
        assert_eq!(backups.len(), 1);
        assert_eq!(std::fs::read_to_string(&backups[0]).unwrap(), edited);
    }

    #[test]
    fn a_clean_external_edit_is_reloaded_without_a_backup() {
        let core = open_in("reload-clean", &json!({ "theme": "light" }));
        let path = Settings::path_in(&core.config_dir);
        std::fs::write(&path, json!({ "theme": "dark" }).to_string()).unwrap();
        let later = modified(&path).unwrap() + Duration::from_secs(2);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();

        core.apply_settings_patch(json!({ "locale": "ja" }))
            .unwrap();
        assert!(crate::persist::corrupt_backups(&core.config_dir, "settings.json").is_empty());
    }

    #[test]
    fn effects_report_a_hotkey_change_only_when_a_hotkey_changed() {
        let core = open_in("effects", &json!({}));
        let (_, effects) = core
            .apply_settings_patch(json!({ "theme": "dark" }))
            .unwrap();
        assert_eq!(effects, SettingsEffects { hotkeys: false });
        let (_, effects) = core
            .apply_settings_patch(json!({ "composeHotkey": "Alt+Shift+A" }))
            .unwrap();
        assert_eq!(effects, SettingsEffects { hotkeys: true });
    }

    #[test]
    fn voice_hotkeys_default_for_old_configs_and_trigger_reregistration() {
        // 旧配置没有语音键：读出默认值，未知字段照旧保留。
        let core = open_in("voice-keys", &json!({ "futureField": 1 }));
        let (settings, effects) = core
            .apply_settings_patch(json!({ "theme": "dark" }))
            .unwrap();
        assert!(!effects.hotkeys);
        assert_eq!(settings.voice_hotkey, "Alt+Cmd+V");
        assert_eq!(settings.voice_translate_hotkey, "Ctrl+Cmd+V");
        for (field, value) in [
            ("voiceHotkey", "Ctrl+Alt+Space"),
            ("voiceTranslateHotkey", "Ctrl+Alt+T"),
        ] {
            let (_, effects) = core.apply_settings_patch(json!({ field: value })).unwrap();
            assert!(effects.hotkeys, "{field} 改了要重注册");
        }
        let saved: serde_json::Value = serde_json::from_slice(&file_bytes(&core)).unwrap();
        assert_eq!(saved["voiceHotkey"], "Ctrl+Alt+Space");
        assert_eq!(saved["voiceTranslateHotkey"], "Ctrl+Alt+T");
        assert_eq!(saved["futureField"], 1);
    }

    #[test]
    fn retired_hotkeys_and_statistics_survive_without_registration_effects() {
        let core = open_in(
            "retired",
            &json!({
                "compareHotkey": "Alt+P", "ocrSilentHotkey": "Alt+Shift+O", "speakHotkey": "Alt+R",
                "sceneModels": { "compare": [{ "provider_id": "openai", "model": "old-model" }] },
                "futureField": { "keep": true }
            }),
        );
        let dir = core.config_dir.clone();
        let stats = br#"{"comparePicks":{"openai:old-model":3},"futureCounter":7}"#;
        std::fs::write(dir.join("stats.json"), stats).unwrap();
        drop(core);
        let core = AppCore::open(dir.clone(), Arc::new(NoHost)).unwrap();
        let (settings, effects) = core.apply_settings_patch(json!({
            "compareHotkey": "Alt+Cmd+P", "ocrSilentHotkey": "Alt+Cmd+S", "speakHotkey": "Alt+Cmd+R"
        })).unwrap();
        assert!(!effects.hotkeys, "退役键位不触发宿主重注册");
        assert_eq!(settings.hotkeys().len(), 6);
        let (_, effects) = core
            .apply_settings_patch(json!({ "ocrHotkey": "Alt+P", "theme": "dark" }))
            .unwrap();
        assert!(effects.hotkeys, "活跃 OCR 键位仍然触发重注册");
        let saved: serde_json::Value = serde_json::from_slice(&file_bytes(&core)).unwrap();
        assert_eq!(saved["compareHotkey"], "Alt+Cmd+P");
        assert_eq!(saved["ocrSilentHotkey"], "Alt+Cmd+S");
        assert_eq!(saved["speakHotkey"], "Alt+Cmd+R");
        assert_eq!(saved["sceneModels"]["compare"][0]["model"], "old-model");
        assert_eq!(saved["futureField"]["keep"], true);
        assert_eq!(std::fs::read(dir.join("stats.json")).unwrap(), stats);
    }
}
