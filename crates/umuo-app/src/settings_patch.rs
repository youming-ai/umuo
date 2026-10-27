//! 设置的写入：把一份 JSON 顶层 patch 叠在**最新**的设置上，校验通过才落盘（迁移计划 §5.4）。
//!
//! Swift 保存队列经 FFI 每次只交自己改的键。规则：
//!
//! 1. **先看文件有没有被别人改过**：mtime 与上次读写时记下的不同就先重载——
//!    外部修改配置时，缩小互相覆盖的窗口。重载读不动、解析不了就沿用内存值，
//!    **不走** `load_or_backup`：那条路会把文件挪走并回落默认值，保存途中这么做等于清空用户的配置。
//! 2. **顶层逐键覆盖**，嵌套对象整体替换、不做深合并。
//! 3. 失败（patch 解析不了、`prepare_for_save` 不通过、写盘失败）时**内存和文件都不变**。

use std::path::Path;
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
        let serde_json::Value::Object(patch) = patch else {
            return Err("设置的改动必须是一个 JSON 对象".to_string());
        };
        let mut current = self.settings.lock().expect("设置锁不应中毒");
        let mut mtime = self.settings_mtime.lock().expect("设置时间戳锁不应中毒");

        let path = Settings::path_in(&self.config_dir);
        let on_disk = modified(&path);
        // 别处改过文件就以文件为准；读不动沿用内存。只在成功时才换进内存，失败时内存不变。
        let latest = if on_disk != *mtime {
            read_strict(&path).unwrap_or_else(|| current.clone())
        } else {
            current.clone()
        };

        let mut merged = serde_json::to_value(&latest).expect("设置结构体一定可序列化");
        let fields = merged.as_object_mut().expect("设置序列化成 JSON 对象");
        for (key, value) in patch {
            fields.insert(key, value);
        }
        let mut next: Settings =
            serde_json::from_value(merged).map_err(|e| format!("设置格式不对：{e}"))?;
        next.prepare_for_save(&latest)?;
        next.save(&self.config_dir).map_err(|e| e.to_string())?;

        // 与内存里的旧值比：宿主注册着的是它，不是刚从文件重载的那份。
        let effects = SettingsEffects {
            hotkeys: current.hotkeys() != next.hotkeys(),
        };
        *mtime = modified(&path);
        *current = next.clone();
        Ok((next, effects))
    }
}

/// 设置文件的修改时间；文件不存在或系统不给就是 `None`。
pub(crate) fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// 重载用：读不动或解析不了就返回 `None`，**不备份、不回落默认值**（理由见模块文档）。
fn read_strict(path: &Path) -> Option<Settings> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
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
            "与 settings-queue.ts 一致：整体替换"
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
        assert_eq!(settings.hotkeys().len(), 4);
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
