//! `umuo_app::ops` 的其余命令经 [`Engine`] 导出：供应商目录、Key 状态与模型列表、历史、
//! 配置导入导出、快捷面板，以及宿主自己发提示时要的请求登记。
//!
//! 和 [`crate::event`] 一样**只做换型**：DTO 摊平成 Record，`From` 一律用不带 `..` 的解构，
//! `umuo-app` 的 DTO 加了字段这里当场编译失败。业务规则全在 `umuo_app::ops`。
//!
//! 这些方法都是同步的（SQLite、文件、Keychain 回调），`list_models` 还要等网络：
//! **只从后台调用**，不放在 MainActor 上（§2.3）。

use std::path::Path;

use umuo_app::ops;

use crate::engine::{Engine, EngineError};

fn failed(message: String) -> EngineError {
    EngineError::Failed { message }
}

// ---------------------------------------------------------------- 供应商、Key

/// 供应商目录里的一条，设置页要的全部字段（`ops::ProviderDto`）。
#[derive(Debug, Clone, uniffi::Record)]
pub struct ProviderDetail {
    pub id: String,
    pub label: String,
    pub default_model: String,
    pub suggested_models: Vec<String>,
    pub keys_url: String,
    pub requires_key: bool,
    pub requires_base_url: bool,
    pub local: bool,
}

impl From<ops::ProviderDto> for ProviderDetail {
    fn from(dto: ops::ProviderDto) -> Self {
        let ops::ProviderDto {
            id,
            label,
            default_model,
            suggested_models,
            keys_url,
            requires_key,
            requires_base_url,
            local,
        } = dto;
        Self {
            id,
            label,
            default_model,
            suggested_models,
            keys_url,
            requires_key,
            requires_base_url,
            local,
        }
    }
}

/// 全部内置供应商的完整信息，顺序与内核目录一致。
#[uniffi::export]
pub fn provider_details() -> Vec<ProviderDetail> {
    ops::provider_catalog()
        .into_iter()
        .map(Into::into)
        .collect()
}

/// 存 Key 之前的规则：供应商必须存在、去掉首尾空白，返回要写进 Keychain 的值。写由 Swift 自己做。
#[uniffi::export]
pub fn prepare_api_key(provider_id: String, api_key: String) -> Result<String, EngineError> {
    ops::prepare_api_key(&provider_id, &api_key).map_err(failed)
}

// ---------------------------------------------------------------- 历史

/// 历史检索条件：只有关键词搜索（来源 App / 模型筛选已退出，第四批精简）。
#[derive(Debug, Clone, Default, uniffi::Record)]
pub struct HistoryFilter {
    pub query: Option<String>,
}

impl From<HistoryFilter> for ops::HistoryFilterDto {
    fn from(filter: HistoryFilter) -> Self {
        let HistoryFilter { query } = filter;
        Self { query }
    }
}

/// 历史的一行（`ops::RecordDto`）。
#[derive(Debug, Clone, uniffi::Record)]
pub struct HistoryRecord {
    pub id: i64,
    pub created_at: i64,
    pub source_text: String,
    pub translated_text: String,
    pub source_lang: Option<String>,
    pub target_lang: String,
    pub provider_id: String,
    pub model: String,
    pub style_id: String,
    pub scene: String,
    pub source_app: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated: bool,
}

impl From<ops::RecordDto> for HistoryRecord {
    fn from(dto: ops::RecordDto) -> Self {
        let ops::RecordDto {
            id,
            created_at,
            source_text,
            translated_text,
            source_lang,
            target_lang,
            provider_id,
            model,
            style_id,
            scene,
            source_app,
            input_tokens,
            output_tokens,
            estimated,
        } = dto;
        Self {
            id,
            created_at,
            source_text,
            translated_text,
            source_lang,
            target_lang,
            provider_id,
            model,
            style_id,
            scene,
            source_app,
            input_tokens,
            output_tokens,
            estimated,
        }
    }
}

// ---------------------------------------------------------------- 快捷面板、导入

/// 菜单栏快捷面板一次要用的全部状态（`ops::QuickState`）。
#[derive(Debug, Clone, uniffi::Record)]
pub struct QuickState {
    pub paused: bool,
    pub provider_label: String,
    pub model: String,
    pub recent: Vec<QuickRecord>,
}

/// 快捷面板里的一条最近翻译。`id` 是历史记录 id，列表用它当 key。
#[derive(Debug, Clone, uniffi::Record)]
pub struct QuickRecord {
    pub id: i64,
    pub source: String,
    pub translation: String,
    pub model: String,
}

/// 导入改动了的一个端点：`provider_id`（自定义端点是 `custom`）→ 新地址（空串 = 删掉覆盖）。
#[derive(Debug, Clone, uniffi::Record)]
pub struct EndpointChange {
    pub provider_id: String,
    pub url: String,
}

/// 一次导入的结果：给界面的摘要，以及让设置当场生效所需的新设置与「快捷键变了没有」。
#[derive(Debug, Clone, uniffi::Record)]
pub struct ImportResult {
    pub provider_id: String,
    pub target_lang: String,
    pub custom_style_count: u32,
    pub glossary_count: u32,
    pub bundle_version: u32,
    pub endpoint_changes: Vec<EndpointChange>,
    pub blacklist_added: Vec<String>,
    pub blacklist_removed: Vec<String>,
    /// 规范化之后的整份设置（JSON，同 `SettingsUpdate.settings_json`）。
    pub settings_json: String,
    /// 快捷键改了：Swift 要当场重注册。
    pub hotkeys_changed: bool,
}

fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[uniffi::export]
impl Engine {
    // ------------------------------------------------ 请求登记（宿主自己发提示、Esc）

    /// 为 `surface` 窗口登记一次新请求并返回 id，同一窗口的上一次请求随之取消。
    ///
    /// 不经流水线的提示（取词失败、黑名单、缺权限、截图识别不到文字）用它：拿到 id 后由宿主自己
    /// 发一条 `Error` 事件；浮窗按 id 把旧请求的迟到事件丢掉。
    pub fn begin_request(&self, surface: String) -> u64 {
        self.core.requests.begin(&surface).id
    }

    /// 取消 `surface` 窗口当前的请求（用户在那个窗口里按了 Esc）。别的窗口不受影响。
    pub fn cancel_surface(&self, surface: String) {
        self.core.requests.cancel(&surface);
    }

    // ------------------------------------------------ 供应商、Key

    /// 只回「配没配过」，不回明文。空白 Key 等于没配。
    pub fn key_status(&self, provider_id: String) -> Result<bool, EngineError> {
        ops::key_status(&self.core, &provider_id).map_err(failed)
    }

    /// 用用户自己的 Key 拉一次模型列表（同时校验 Key），最长 15 秒。**阻塞当前线程等网络**，只从后台调用。
    pub fn list_models(&self, provider_id: String) -> Result<Vec<String>, EngineError> {
        self.rt()
            .block_on(ops::list_models(&self.core, &provider_id))
            .map_err(failed)
    }

    // ------------------------------------------------ 历史

    /// 按条件查历史，新的在前。每页最多 500 条（`ops` 里兜底）。
    pub fn history_query(
        &self,
        filter: Option<HistoryFilter>,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<HistoryRecord>, EngineError> {
        ops::history_query(&self.core, filter.map(Into::into), limit, offset)
            .map(|rows| rows.into_iter().map(Into::into).collect())
            .map_err(failed)
    }

    /// 删一条历史，返回是否真的删掉了。
    pub fn history_delete(&self, id: i64) -> Result<bool, EngineError> {
        ops::history_delete(&self.core, id).map_err(failed)
    }

    /// 清空历史，返回清掉的条数。库里的旧收藏与用量账本不受影响。
    pub fn history_clear(&self) -> Result<u32, EngineError> {
        ops::history_clear(&self.core).map(count).map_err(failed)
    }

    // ------------------------------------------------ 配置导入导出

    /// 导出配置与术语表到 `~/Downloads` 下的固定位置（`config_io::export_path_in`），返回完整路径。不含 Key。
    pub fn export_config(&self) -> Result<String, EngineError> {
        let home = std::env::var_os("HOME")
            .ok_or_else(|| failed("读不到 HOME，无法确定导出位置".into()))?;
        ops::export_config(&self.core, Path::new(&home)).map_err(failed)
    }

    /// 从文件导入配置与术语表。整份包先校验，不合法就一个文件都不写；不碰 Keychain。
    pub fn import_config(&self, path: String) -> Result<ImportResult, EngineError> {
        let ops::Imported {
            summary,
            settings,
            effects,
        } = ops::import_config(&self.core, Path::new(&path)).map_err(failed)?;
        let umuo_app::config_io::ImportSummary {
            provider_id,
            target_lang,
            custom_style_count,
            glossary_count,
            bundle_version,
            endpoint_changes,
            blacklist_added,
            blacklist_removed,
        } = summary;
        let umuo_app::settings_patch::SettingsEffects { hotkeys } = effects;
        Ok(ImportResult {
            provider_id,
            target_lang,
            custom_style_count: count(custom_style_count),
            glossary_count: count(glossary_count),
            bundle_version,
            endpoint_changes: endpoint_changes
                .into_iter()
                .map(|(provider_id, url)| EndpointChange { provider_id, url })
                .collect(),
            blacklist_added,
            blacklist_removed,
            settings_json: serde_json::to_string(&settings).expect("设置结构体一定可序列化"),
            hotkeys_changed: hotkeys,
        })
    }

    // ------------------------------------------------ 快捷面板

    /// 快捷面板的状态。`paused` 是宿主的状态（全局快捷键暂停），由 Swift 传进来。
    pub fn quick_state(&self, paused: bool) -> QuickState {
        let ops::QuickState {
            paused,
            provider_label,
            model,
            recent,
        } = ops::quick_state(&self.core, paused);
        QuickState {
            paused,
            provider_label,
            model,
            recent: recent
                .into_iter()
                .map(
                    |ops::QuickRecord {
                         id,
                         source,
                         translation,
                         model,
                     }| QuickRecord {
                        id,
                        source,
                        translation,
                        model,
                    },
                )
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use serde_json::{json, Value};

    use super::*;
    use crate::host::{FocusSource, HostBridge, HostFailure};

    /// 只有 deepseek 配了 Key。
    struct KeyHost;

    impl HostBridge for KeyHost {
        fn api_key(&self, provider_id: String) -> Result<Option<String>, HostFailure> {
            Ok((provider_id == "deepseek").then(|| "sk-test".to_string()))
        }
        fn frontmost_app_name(&self) -> Option<String> {
            None
        }
        fn frontmost_app_token(&self) -> Option<String> {
            None
        }
        fn write_back(&self, _: FocusSource, _: String, _: String) -> Result<(), HostFailure> {
            Err(HostFailure::Failed {
                detail: "这些测试不写回".into(),
            })
        }
    }

    fn open() -> Arc<Engine> {
        static SEQ: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "umuo-ffi-ops-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), r#"{"proxyMode":"none"}"#).unwrap();
        Engine::open(dir.to_string_lossy().into_owned(), Arc::new(KeyHost)).unwrap()
    }

    #[test]
    fn history_goes_through_the_store() {
        let engine = open();
        assert!(engine.history_query(None, 50, 0).unwrap().is_empty());
        assert_eq!(engine.history_clear().unwrap(), 0);
        assert!(!engine.history_delete(42).unwrap());

        assert!(engine.quick_state(true).paused);
    }

    #[test]
    fn keys_follow_the_host_and_providers_follow_the_catalog() {
        let engine = open();
        assert!(engine.key_status("deepseek".into()).unwrap());
        assert!(!engine.key_status("openai".into()).unwrap());
        assert_eq!(
            provider_details().len(),
            umuo_core::provider::PROVIDERS.len()
        );
        assert_eq!(
            prepare_api_key("openai".into(), " sk \n".into()).unwrap(),
            "sk"
        );
        assert!(prepare_api_key("nope".into(), "sk".into()).is_err());
    }

    #[test]
    fn a_notice_request_supersedes_the_previous_one_on_its_surface() {
        let engine = open();
        let first = engine.begin_request("panel".into());
        let second = engine.begin_request("panel".into());
        assert!(second > first);
        engine.cancel_surface("panel".into());
    }

    #[test]
    fn an_exported_config_imports_back_with_its_effects() {
        let engine = open();
        engine
            .apply_settings_patch(json!({ "composeHotkey": "Alt+Shift+A" }).to_string())
            .unwrap();
        let bundle = engine.core.config_dir.join("bundle.json");
        let settings = engine.core.settings.lock().unwrap().clone();
        let glossaries = umuo_app::legacy_glossaries::Glossaries::load(&engine.core.config_dir);
        std::fs::write(
            &bundle,
            umuo_app::config_io::export_json(&settings, &glossaries),
        )
        .unwrap();

        let other = open();
        let imported = other
            .import_config(bundle.to_string_lossy().into_owned())
            .unwrap();
        assert!(imported.hotkeys_changed);
        let json: Value = serde_json::from_str(&imported.settings_json).unwrap();
        assert_eq!(json["composeHotkey"], "Alt+Shift+A");
        assert!(other
            .import_config("/nonexistent/umuo.json".into())
            .is_err());
    }
}
