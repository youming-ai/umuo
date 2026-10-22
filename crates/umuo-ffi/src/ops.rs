//! `umuo_app::ops` 的其余命令经 [`Engine`] 导出：历史、收藏、用量、术语表、Key 状态与模型列表、
//! 配置导入导出、对比偏好、快捷面板，以及宿主自己发提示时要的请求登记。
//!
//! 和 [`crate::event`] 一样**只做换型**：DTO 摊平成 Record，`From` 一律用不带 `..` 的解构，
//! `umuo-app` 的 DTO 加了字段这里当场编译失败。业务规则全在 `umuo_app::ops`。
//!
//! **术语表走 JSON，不走 Record**：`Glossary` / `GlossaryEntry` 带 `extra`（本版本不认识的字段，
//! `docs/ARCHITECTURE.md` §4）。镜像成 Record 的话，Swift 改一张表再存回来，未知字段就悄悄丢了——
//! 正是 #70 修过的那一类数据丢失。JSON 的形状就是 `glossaries.json` 里一张表的形状。
//!
//! 这些方法都是同步的（SQLite、文件、Keychain 回调），`list_models` 还要等网络：
//! **只从后台调用**，不放在 MainActor 上（§2.3）。

use std::path::Path;

use umuo_app::ops;

use crate::engine::{Engine, EngineError};

fn failed(message: String) -> EngineError {
    EngineError::Failed { message }
}

// ---------------------------------------------------------------- 供应商、风格、Key

/// 供应商目录里的一条，设置页与浮窗「换个模型」要的全部字段（`ops::ProviderDto`）。
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

/// 翻译风格（内置 + 用户自建）。
#[derive(Debug, Clone, uniffi::Record)]
pub struct StyleInfo {
    pub id: String,
    pub label: String,
    pub custom: bool,
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

// ---------------------------------------------------------------- 历史、收藏、用量

/// 历史检索条件，三者 AND（`ops::HistoryFilterDto`）。
#[derive(Debug, Clone, Default, uniffi::Record)]
pub struct HistoryFilter {
    pub query: Option<String>,
    pub source_app: Option<String>,
    pub model: Option<String>,
}

impl From<HistoryFilter> for ops::HistoryFilterDto {
    fn from(filter: HistoryFilter) -> Self {
        let HistoryFilter {
            query,
            source_app,
            model,
        } = filter;
        Self {
            query,
            source_app,
            model,
        }
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
    pub cost_usd: Option<f64>,
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
            cost_usd,
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
            cost_usd,
        }
    }
}

/// 筛选下拉的候选值：历史里真正出现过的来源 App 与模型。
#[derive(Debug, Clone, uniffi::Record)]
pub struct HistoryFacets {
    pub apps: Vec<String>,
    pub models: Vec<String>,
}

/// 一条收藏（`ops::FavoriteDto`）。`kind` 是 `word` / `sentence`。
#[derive(Debug, Clone, uniffi::Record)]
pub struct Favorite {
    pub id: i64,
    pub created_at: i64,
    pub kind: String,
    pub text: String,
    pub translation: Option<String>,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
}

impl From<ops::FavoriteDto> for Favorite {
    fn from(dto: ops::FavoriteDto) -> Self {
        let ops::FavoriteDto {
            id,
            created_at,
            kind,
            text,
            translation,
            source_lang,
            target_lang,
        } = dto;
        Self {
            id,
            created_at,
            kind,
            text,
            translation,
            source_lang,
            target_lang,
        }
    }
}

/// 本月用量（`ops::UsageDto`）。`unpriced` 是价格未知、没算进总额的条数。
#[derive(Debug, Clone, uniffi::Record)]
pub struct UsageSummary {
    pub count: u32,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub unpriced: u32,
}

/// 某一天的用量。`day` 是本地日期 `YYYY-MM-DD`。
#[derive(Debug, Clone, uniffi::Record)]
pub struct DayUsage {
    pub day: String,
    pub count: u32,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub unpriced: u32,
}

/// 某个供应商本月的用量（设置页「已用 x / 上限 y」）。
#[derive(Debug, Clone, uniffi::Record)]
pub struct ProviderUsage {
    pub provider_id: String,
    pub count: u32,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub unpriced: u32,
}

impl From<umuo_store::DayUsage> for DayUsage {
    fn from(row: umuo_store::DayUsage) -> Self {
        let umuo_store::DayUsage {
            day,
            count,
            input_tokens,
            output_tokens,
            cost_usd,
            unpriced,
        } = row;
        Self {
            day,
            count,
            input_tokens,
            output_tokens,
            cost_usd,
            unpriced,
        }
    }
}

impl From<umuo_store::ProviderUsage> for ProviderUsage {
    fn from(row: umuo_store::ProviderUsage) -> Self {
        let umuo_store::ProviderUsage {
            provider_id,
            count,
            input_tokens,
            output_tokens,
            cost_usd,
            unpriced,
        } = row;
        Self {
            provider_id,
            count,
            input_tokens,
            output_tokens,
            cost_usd,
            unpriced,
        }
    }
}

// ---------------------------------------------------------------- 对比偏好、快捷面板、导入

/// 对比窗里被标成「最佳」的次数。
#[derive(Debug, Clone, uniffi::Record)]
pub struct ComparePick {
    pub provider_id: String,
    pub model: String,
    pub count: u32,
}

impl From<ops::PickDto> for ComparePick {
    fn from(dto: ops::PickDto) -> Self {
        let ops::PickDto {
            provider_id,
            model,
            count,
        } = dto;
        Self {
            provider_id,
            model,
            count,
        }
    }
}

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
    /// 快捷键改了：Swift 要当场重注册（Tauri 在这里跑 `run_settings_effects`）。
    pub hotkeys_changed: bool,
}

fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

fn glossaries_json(lists: &[umuo_core::glossary::Glossary]) -> String {
    serde_json::to_string(lists).expect("术语表一定可序列化")
}

#[uniffi::export]
impl Engine {
    // ------------------------------------------------ 请求登记（宿主自己发提示、Esc）

    /// 为 `surface` 窗口登记一次新请求并返回 id，同一窗口的上一次请求随之取消。
    ///
    /// 不经流水线的提示（取词失败、黑名单、缺权限、截图识别不到文字）用它：拿到 id 后由宿主自己
    /// 发一条 `Error` 事件，与 Tauri 的 `translator::emit_notice` 一样，浮窗按 id 把旧请求的迟到事件丢掉。
    pub fn begin_request(&self, surface: String) -> u64 {
        self.core.requests.begin(&surface).id
    }

    /// 取消 `surface` 窗口当前的请求（用户在那个窗口里按了 Esc）。别的窗口不受影响。
    pub fn cancel_surface(&self, surface: String) {
        self.core.requests.cancel(&surface);
    }

    // ------------------------------------------------ 供应商、风格、Key

    /// 浮窗「换个模型」要的：这次真能用的供应商（已配 Key 的，加上本地模型）。逐家读 Keychain。
    pub fn configured_providers(&self) -> Vec<ProviderDetail> {
        ops::configured_providers(&self.core)
            .into_iter()
            .map(Into::into)
            .collect()
    }

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

    /// 翻译风格目录（内置 + 用户自建）。
    pub fn style_catalog(&self) -> Vec<StyleInfo> {
        ops::style_catalog(&self.core)
            .into_iter()
            .map(|ops::StyleDto { id, label, custom }| StyleInfo { id, label, custom })
            .collect()
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

    pub fn history_facets(&self) -> Result<HistoryFacets, EngineError> {
        let umuo_store::Facets { apps, models } =
            ops::history_facets(&self.core).map_err(failed)?;
        Ok(HistoryFacets { apps, models })
    }

    /// 删一条历史，返回是否真的删掉了。
    pub fn history_delete(&self, id: i64) -> Result<bool, EngineError> {
        ops::history_delete(&self.core, id).map_err(failed)
    }

    /// 清空历史（收藏不受影响），返回清掉的条数。
    pub fn history_clear(&self) -> Result<u32, EngineError> {
        ops::history_clear(&self.core).map(count).map_err(failed)
    }

    // ------------------------------------------------ 收藏

    /// 切换收藏，返回切换**之后**的状态（true = 现在已收藏）。空文本报错。
    pub fn favorite_toggle(
        &self,
        text: String,
        translation: Option<String>,
    ) -> Result<bool, EngineError> {
        ops::favorite_toggle(&self.core, &text, translation).map_err(failed)
    }

    /// 一次问完若干条文本当前是否已收藏（历史列表一屏一百来行）。
    pub fn favorites_status(&self, texts: Vec<String>) -> Result<Vec<bool>, EngineError> {
        ops::favorites_status(&self.core, &texts).map_err(failed)
    }

    pub fn favorites_list(&self, limit: u32, offset: u32) -> Result<Vec<Favorite>, EngineError> {
        ops::favorites_list(&self.core, limit, offset)
            .map(|rows| rows.into_iter().map(Into::into).collect())
            .map_err(failed)
    }

    pub fn favorite_remove(&self, id: i64) -> Result<bool, EngineError> {
        ops::favorite_remove(&self.core, id).map_err(failed)
    }

    // ------------------------------------------------ 用量

    /// 本月的次数、token 与费用。
    pub fn usage_summary(&self) -> Result<UsageSummary, EngineError> {
        let ops::UsageDto {
            count,
            input_tokens,
            output_tokens,
            cost_usd,
            unpriced,
        } = ops::usage_summary(&self.core).map_err(failed)?;
        Ok(UsageSummary {
            count,
            input_tokens,
            output_tokens,
            cost_usd,
            unpriced,
        })
    }

    /// 最近 `days` 天（夹到 1–365）的按日用量。
    pub fn usage_daily(&self, days: u32) -> Result<Vec<DayUsage>, EngineError> {
        ops::usage_daily(&self.core, days)
            .map(|rows| rows.into_iter().map(Into::into).collect())
            .map_err(failed)
    }

    /// 本月各供应商的花费。
    pub fn monthly_spend(&self) -> Result<Vec<ProviderUsage>, EngineError> {
        ops::monthly_spend(&self.core)
            .map(|rows| rows.into_iter().map(Into::into).collect())
            .map_err(failed)
    }

    // ------------------------------------------------ 术语表（JSON，见模块文档）

    /// 全部术语表，JSON 数组（形状同 `glossaries.json` 的 `lists`，含未知字段）。
    pub fn glossary_list_json(&self) -> String {
        glossaries_json(&ops::glossary_list(&self.core))
    }

    /// 保存（新建或覆盖）一张术语表（JSON 对象），返回保存后的全部术语表（JSON 数组）。
    pub fn glossary_save_json(&self, glossary_json: String) -> Result<String, EngineError> {
        let glossary = serde_json::from_str(&glossary_json).map_err(|e| failed(e.to_string()))?;
        ops::glossary_save(&self.core, glossary)
            .map(|lists| glossaries_json(&lists))
            .map_err(failed)
    }

    /// 删一张术语表，返回剩下的全部术语表（JSON 数组）。
    pub fn glossary_remove(&self, id: String) -> Result<String, EngineError> {
        ops::glossary_remove(&self.core, &id)
            .map(|lists| glossaries_json(&lists))
            .map_err(failed)
    }

    /// 从 CSV / TSV 文本导入，**替换**该表的全部条目，返回导入条数。失败时文件不变。
    pub fn glossary_import(&self, id: String, text: String) -> Result<u32, EngineError> {
        ops::glossary_import(&self.core, &id, &text)
            .map(count)
            .map_err(failed)
    }

    /// 导出为 CSV 文本。
    pub fn glossary_export(&self, id: String) -> Result<String, EngineError> {
        ops::glossary_export(&self.core, &id).map_err(failed)
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

    // ------------------------------------------------ 对比偏好、快捷面板

    /// 对比偏好的排行（被标成「最佳」的次数，多的在前）。
    pub fn compare_picks(&self) -> Vec<ComparePick> {
        ops::picks_from(&self.core)
            .into_iter()
            .map(Into::into)
            .collect()
    }

    /// 记一次「选它」，返回更新后的完整排行。未知供应商报错。
    pub fn record_compare_pick(
        &self,
        provider_id: String,
        model: String,
    ) -> Result<Vec<ComparePick>, EngineError> {
        ops::record_compare_pick(&self.core, &provider_id, &model)
            .map(|picks| picks.into_iter().map(Into::into).collect())
            .map_err(failed)
    }

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
    fn a_glossary_round_trip_keeps_fields_this_version_does_not_know() {
        // 镜像成 Record 会丢掉这两个字段（#70 修过的数据丢失）；走 JSON 就原样保留。
        let engine = open();
        let saved = engine
            .glossary_save_json(
                json!({
                    "id": "g1",
                    "name": "术语",
                    "entries": [{ "source": "app", "target": "应用", "note": "未来版本的字段" }],
                    "color": "teal",
                })
                .to_string(),
            )
            .unwrap();
        let lists: Value = serde_json::from_str(&saved).unwrap();
        assert_eq!(lists[0]["color"], "teal");
        assert_eq!(lists[0]["entries"][0]["note"], "未来版本的字段");
        let listed: Value = serde_json::from_str(&engine.glossary_list_json()).unwrap();
        assert_eq!(listed, lists);

        assert_eq!(
            engine
                .glossary_import("g1".into(), "a,b\nc,d".into())
                .unwrap(),
            2
        );
        assert!(engine.glossary_export("g1".into()).unwrap().contains("c,d"));
        assert_eq!(engine.glossary_remove("g1".into()).unwrap(), "[]");
        assert!(engine.glossary_save_json("不是 JSON".into()).is_err());
    }

    #[test]
    fn history_and_favorites_go_through_the_store() {
        let engine = open();
        assert!(engine.history_query(None, 50, 0).unwrap().is_empty());
        let facets = engine.history_facets().unwrap();
        assert!(facets.apps.is_empty() && facets.models.is_empty());
        assert_eq!(engine.history_clear().unwrap(), 0);
        assert!(!engine.history_delete(42).unwrap());

        assert!(engine.favorite_toggle("hello".into(), None).unwrap());
        assert_eq!(
            engine
                .favorites_status(vec!["hello".into(), "other".into()])
                .unwrap(),
            vec![true, false]
        );
        let favorites = engine.favorites_list(10, 0).unwrap();
        assert_eq!(favorites[0].kind, "word");
        assert!(engine.favorite_remove(favorites[0].id).unwrap());
        assert!(engine.favorite_toggle("  ".into(), None).is_err());

        assert_eq!(engine.usage_summary().unwrap().count, 0);
        assert!(engine.usage_daily(14).unwrap().is_empty());
        assert!(engine.monthly_spend().unwrap().is_empty());
        assert!(engine.quick_state(true).paused);
    }

    #[test]
    fn keys_providers_and_picks_follow_the_host() {
        let engine = open();
        assert!(engine.key_status("deepseek".into()).unwrap());
        assert!(!engine.key_status("openai".into()).unwrap());
        let ids: Vec<String> = engine
            .configured_providers()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert!(ids.contains(&"deepseek".to_string()) && ids.contains(&"ollama".to_string()));
        assert!(!ids.contains(&"openai".to_string()));
        assert_eq!(
            provider_details().len(),
            umuo_core::provider::PROVIDERS.len()
        );
        assert_eq!(
            prepare_api_key("openai".into(), " sk \n".into()).unwrap(),
            "sk"
        );
        assert!(prepare_api_key("nope".into(), "sk".into()).is_err());
        assert!(!engine.style_catalog().is_empty());

        assert!(engine
            .record_compare_pick("nope".into(), "m".into())
            .is_err());
        let picks = engine
            .record_compare_pick("deepseek".into(), "deepseek-chat".into())
            .unwrap();
        assert_eq!(picks[0].count, 1);
        assert_eq!(engine.compare_picks().len(), 1);
    }

    #[test]
    fn a_notice_request_supersedes_the_previous_one_on_its_surface() {
        let engine = open();
        let first = engine.begin_request("panel".into());
        let second = engine.begin_request("panel".into());
        assert!(second > first);
        engine.cancel_surface("compare".into());
    }

    #[test]
    fn an_exported_config_imports_back_with_its_effects() {
        let engine = open();
        engine
            .apply_settings_patch(json!({ "composeHotkey": "Alt+Shift+A" }).to_string())
            .unwrap();
        let bundle = engine.core.config_dir.join("bundle.json");
        let settings = engine.core.settings.lock().unwrap().clone();
        let glossaries = engine.core.glossaries.lock().unwrap().clone();
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
