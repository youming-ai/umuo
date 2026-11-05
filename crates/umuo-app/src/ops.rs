//! 界面命令的业务部分：供应商目录、Key 状态、模型列表、历史、快捷面板、配置导入导出。
//!
//! `umuo-ffi` 只做参数转发与换型、调这里——业务规则不放进 Swift 或 FFI 导出层。
//! 这里的 DTO 由 `umuo-ffi/src/ops.rs` 用不带 `..` 的解构换成 UniFFI Record，改字段那边当场编译失败。
//!
//! Key 的约定不变：这里只回「配没配过」，**不回明文**。

use std::path::Path;
use std::time::Duration;

use umuo_core::provider::{self, ProviderKind};

use crate::config_io::ImportSummary;
use crate::legacy_glossaries::Glossaries;
use crate::settings::Settings;
use crate::settings_patch::SettingsEffects;
use crate::{config_io, history, AppCore};

// ---------------------------------------------------------------- 供应商

#[derive(Debug, Clone)]
pub struct ProviderDto {
    pub id: String,
    pub label: String,
    pub default_model: String,
    pub suggested_models: Vec<String>,
    pub keys_url: String,
    /// 本地模型（Ollama / LM Studio）不需要 Key，UI 据此隐藏 Key 输入框。
    pub requires_key: bool,
    /// 必须由用户填 Base URL（Azure 的资源终结点、自定义端点）。
    pub requires_base_url: bool,
    pub local: bool,
}

pub fn provider_catalog() -> Vec<ProviderDto> {
    provider::PROVIDERS.iter().map(to_dto).collect()
}

pub fn to_dto(p: &provider::Provider) -> ProviderDto {
    ProviderDto {
        id: p.id.to_string(),
        label: p.label.to_string(),
        default_model: p.default_model.to_string(),
        suggested_models: p.suggested_models.iter().map(|m| m.to_string()).collect(),
        keys_url: p.keys_url.to_string(),
        requires_key: p.requires_key(),
        requires_base_url: p.requires_base_url(),
        local: p.kind == ProviderKind::Local,
    }
}

/// 只回「配没配过」，不回明文——见模块文档。
pub fn key_status(core: &AppCore, provider_id: &str) -> Result<bool, String> {
    let secret = core.host.api_key(provider_id)?;
    Ok(secret.is_some_and(|s| !s.trim().is_empty()))
}

/// 存 Key 之前的规则：供应商必须存在，Key 去掉首尾空白。
///
/// 返回要写进 Keychain 的值。写本身是宿主的事（Swift 直接调 Security.framework），
/// 规则放在 Rust 里只有一份：拼错的 id 会在 Keychain 里留下一条永远读不到的记录。
pub fn prepare_api_key(provider_id: &str, api_key: &str) -> Result<String, String> {
    if provider::find_provider(provider_id).is_none() {
        return Err(format!("未知供应商：{provider_id}"));
    }
    Ok(api_key.trim().to_string())
}

/// 用用户自己的 Key 拉一次模型列表，同时也就校验了 Key 是否有效（PRD §6.2 第 3 步）。
pub async fn list_models(core: &AppCore, provider_id: &str) -> Result<Vec<String>, String> {
    let provider = provider::find_provider(provider_id).ok_or_else(|| "未知供应商".to_string())?;
    let api_key = core.host.api_key(provider.id)?.unwrap_or_default();
    let settings = core.settings.lock().expect("设置锁不应中毒").clone();
    let base_url = settings
        .base_url_override(provider)
        .map_err(|e| e.to_string())?;
    let wire = match base_url.as_deref() {
        Some(url) => umuo_core::wire::build_models_request_at(provider, url, &api_key),
        None => umuo_core::wire::build_models_request(provider, &api_key),
    }
    .map_err(|e| e.to_string())?;
    let body = umuo_core::transport::fetch_json(&core.client, &wire, Duration::from_secs(15))
        .await
        .map_err(|e| e.to_string())?;
    umuo_core::wire::parse_models_list(provider.protocol, &body).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- 翻译历史（PRD §5.9）

/// 历史列表每页最多多少条。上限是给界面兜底的：一次拉几千条会让窗口卡住，
/// 而用户真正会翻的也就是最近这些。
const HISTORY_PAGE_MAX: u32 = 500;

/// 历史检索条件（PRD §5.9）：只有关键词搜索。来源 App / 模型筛选已退出（第四批精简），
/// 存储层的筛选能力保留不动。
#[derive(Debug, Clone, Default)]
pub struct HistoryFilterDto {
    pub query: Option<String>,
}

/// 按关键词查询历史。空条件等于「显示全部」。
pub fn history_query(
    core: &AppCore,
    filter: Option<HistoryFilterDto>,
    limit: u32,
    offset: u32,
) -> Result<Vec<RecordDto>, String> {
    let filter = filter.unwrap_or_default();
    let rows = history::with_store(core, |store| {
        store.query(
            &umuo_store::HistoryFilter {
                query: filter.query,
            },
            limit.min(HISTORY_PAGE_MAX),
            offset,
        )
    })?;
    Ok(records_to_dto(rows))
}

pub fn history_delete(core: &AppCore, id: i64) -> Result<bool, String> {
    history::with_store(core, |store| store.delete(id))
}

/// 按记录 id 游标读取历史。每页最多 500 条，跨页新增记录不会导致重复或跳行。
pub fn history_query_before(
    core: &AppCore,
    filter: Option<HistoryFilterDto>,
    limit: u32,
    before_id: Option<i64>,
) -> Result<Vec<RecordDto>, String> {
    let filter = filter.unwrap_or_default();
    let rows = history::with_store(core, |store| {
        store.query_before(
            &umuo_store::HistoryFilter {
                query: filter.query,
            },
            limit.min(HISTORY_PAGE_MAX),
            before_id,
        )
    })?;
    Ok(records_to_dto(rows))
}

pub fn history_clear(core: &AppCore) -> Result<usize, String> {
    history::with_store(core, |store| store.clear())
}

/// 历史的一行。与 `umuo_store::Record` 分开是为了**不让存储层的形状直接变成 FFI 契约**：
/// 表结构以后要加列时，Swift 不该被迫一起改。
#[derive(Debug, Clone)]
pub struct RecordDto {
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

/// 存储层记录 → 界面记录。
///
/// 用普通函数而不是 `impl From<Vec<...>> for Vec<...>`：后者会撞上孤儿规则
/// （`Vec` 是外部类型），而且一个自由函数在这里读起来也更直白。
pub fn records_to_dto(rows: Vec<umuo_store::Record>) -> Vec<RecordDto> {
    rows.into_iter()
        .map(|row| RecordDto {
            id: row.id,
            created_at: row.entry.created_at,
            source_text: row.entry.source_text,
            translated_text: row.entry.translated_text,
            source_lang: row.entry.source_lang,
            target_lang: row.entry.target_lang,
            provider_id: row.entry.provider_id,
            model: row.entry.model,
            style_id: row.entry.style_id,
            scene: row.entry.scene,
            source_app: row.entry.source_app,
            input_tokens: row.entry.input_tokens,
            output_tokens: row.entry.output_tokens,
            estimated: row.entry.estimated,
        })
        .collect()
}

// ---------------------------------------------------------------- 菜单栏快捷面板（PRD §7.1）

/// 面板里最多显示几条最近翻译。
const QUICK_RECENT_LIMIT: u32 = 5;
/// 面板里每条最多这么多字符：面板只有 340 宽，一整段选文会把最近翻译挤成一条。
const PANEL_TEXT_LIMIT: usize = 60;

/// 快捷面板一次要用的全部状态。
///
/// **打成一个命令**而不是四个：面板一打开就要四样东西，四次往返只会让
/// 它先渲染出一个半空的界面再跳一下。
#[derive(Debug, Clone)]
pub struct QuickState {
    pub paused: bool,
    pub provider_label: String,
    pub model: String,
    pub recent: Vec<QuickRecord>,
}

/// 快捷面板里的一条最近翻译，原文与译文已按面板宽度截断。
#[derive(Debug, Clone)]
pub struct QuickRecord {
    /// 历史记录 id。**用它当列表标识**，不要用下标——
    /// 列表会随新翻译而变化，下标当标识会让 SwiftUI 复用错行。
    pub id: i64,
    pub source: String,
    pub translation: String,
    pub model: String,
}

/// `paused` 是宿主的状态（全局快捷键暂停），由宿主传进来。
pub fn quick_state(core: &AppCore, paused: bool) -> QuickState {
    let settings = core.settings.lock().expect("设置锁不应中毒").clone();
    let provider_label = provider::find_provider(&settings.provider_id)
        .map(|p| p.label.to_string())
        .unwrap_or_else(|| settings.provider_id.clone());

    // 最近几条：拿不到就空列表，不该让整个面板打不开。
    let recent = history::with_store(core, |store| {
        store.query(&umuo_store::HistoryFilter::default(), QUICK_RECENT_LIMIT, 0)
    })
    .map(|rows| {
        rows.into_iter()
            .map(|row| QuickRecord {
                id: row.id,
                source: trim_display(&row.entry.source_text, PANEL_TEXT_LIMIT),
                translation: trim_display(&row.entry.translated_text, PANEL_TEXT_LIMIT),
                model: row.entry.model,
            })
            .collect()
    })
    .unwrap_or_default();

    QuickState {
        paused,
        provider_label,
        model: settings.model,
        recent,
    }
}

/// 按**字符**而不是字节截断：中文按字节切会切出半个字。
pub fn trim_display(text: &str, limit: usize) -> String {
    let cleaned = text.trim().replace('\n', " ");
    if cleaned.chars().count() <= limit {
        return cleaned;
    }
    let head: String = cleaned.chars().take(limit.saturating_sub(1)).collect();
    format!("{head}…")
}

// ---------------------------------------------------------------- 配置导入导出（PRD §6.4）

/// 导出配置与术语表到 `home` 下的固定位置，返回写出的完整路径。
///
/// 导出内容**不含 API Key**（Key 只在 Keychain，设置与术语表里都没有它）。
pub fn export_config(core: &AppCore, home: &Path) -> Result<String, String> {
    let settings = core.settings.lock().expect("设置锁不应中毒").clone();
    let glossaries = Glossaries::load(&core.config_dir);

    let path = config_io::export_path_in(home);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }

    let json = config_io::export_json(&settings, &glossaries);
    std::fs::write(&path, json).map_err(|e| format!("写入失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// 一次导入的结果：给界面的摘要，以及宿主要让设置当场生效所需的新设置与副作用。
pub struct Imported {
    pub summary: ImportSummary,
    pub settings: Settings,
    pub effects: SettingsEffects,
}

/// 从文件导入配置与术语表。
///
/// **不碰 Keychain**：导入的包里没有 Key，用户的 Key 保持原样。
/// 设置走与保存相同的 [`AppCore::apply_settings_patch`]（整份作 patch），不绕过任何一条校验。
pub fn import_config(core: &AppCore, path: &Path) -> Result<Imported, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("读取失败：{e}"))?;
    // 先在内存里把整份包校验一遍，**任何一个文件都还没写**：不合法的包整份拒绝，
    // 不会因为设置校验失败而只导进来术语表。
    let current = core.settings.lock().expect("设置锁不应中毒").clone();
    let glossaries = Glossaries::load(&core.config_dir);
    let prepared = config_io::prepare_import(&raw, &current, &glossaries)?;
    // 术语表在设置**校验通过之后、落盘之前**写：保存时对着最新文件再校验一次，
    // 那次不通过也不能让术语表已经被覆盖。
    let patch = serde_json::to_value(&prepared.settings).expect("设置结构体一定可序列化");
    let (settings, effects) = core.apply_settings_patch_with(patch, || {
        prepared
            .glossaries
            .save(&core.config_dir)
            .map_err(|e| e.to_string())
    })?;
    Ok(Imported {
        summary: prepared.summary,
        settings,
        effects,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::host::{FocusSource, Host};

    /// 只有 deepseek 配了 Key。
    struct KeyHost;

    impl Host for KeyHost {
        fn api_key(&self, provider_id: &str) -> Result<Option<String>, String> {
            Ok(match provider_id {
                "deepseek" => Some("sk-test".to_string()),
                "openai" => Some("   ".to_string()),
                _ => None,
            })
        }
        fn frontmost_app_name(&self) -> Option<String> {
            None
        }
        fn frontmost_app_token(&self) -> Option<String> {
            None
        }
        fn write_back(&self, _: FocusSource, _: &str, _: &str) -> Result<(), String> {
            unreachable!("这些测试不写回")
        }
    }

    fn open_in(name: &str) -> AppCore {
        let dir = std::env::temp_dir().join(format!("umuo-app-ops-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        AppCore::open(dir, Arc::new(KeyHost)).unwrap()
    }

    #[test]
    fn history_cursor_preserves_search_and_the_page_limit() {
        let core = open_in("history-cursor");
        let mut entry = umuo_store::NewRecord {
            created_at: 1,
            source_text: "match".into(),
            translated_text: "译文".into(),
            source_lang: None,
            target_lang: "zh-CN".into(),
            provider_id: "openai".into(),
            model: "test".into(),
            style_id: "standard".into(),
            scene: "compose".into(),
            source_app: None,
            input_tokens: 0,
            output_tokens: 0,
            estimated: false,
            cost_usd: None,
        };
        history::with_store(&core, |store| {
            for _ in 0..505 {
                store.insert(&entry)?;
            }
            entry.source_text = "other".into();
            store.insert(&entry)?;
            Ok(())
        })
        .unwrap();
        let filter = Some(HistoryFilterDto {
            query: Some("match".into()),
        });
        let first = history_query_before(&core, filter.clone(), 1000, None).unwrap();
        assert_eq!(first.len(), 500);
        assert_eq!(first.first().unwrap().id, 505);
        let second =
            history_query_before(&core, filter, 1000, Some(first.last().unwrap().id)).unwrap();
        assert_eq!(
            second.iter().map(|r| r.id).collect::<Vec<_>>(),
            [5, 4, 3, 2, 1]
        );
    }

    #[test]
    fn key_status_is_a_bool_and_a_blank_key_does_not_count() {
        let core = open_in("key-status");
        assert!(key_status(&core, "deepseek").unwrap());
        assert!(!key_status(&core, "openai").unwrap(), "空白 Key 等于没配");
        assert!(!key_status(&core, "anthropic").unwrap());
    }

    #[test]
    fn a_key_is_trimmed_and_an_unknown_provider_is_rejected() {
        assert_eq!(
            prepare_api_key("deepseek", "  sk-1 \n").unwrap(),
            "sk-1".to_string()
        );
        assert_eq!(
            prepare_api_key("nope", "sk-1").unwrap_err(),
            "未知供应商：nope"
        );
    }

    #[test]
    fn an_exported_config_imports_back_through_the_settings_patch() {
        let core = open_in("export");
        core.apply_settings_patch(
            serde_json::json!({ "theme": "dark", "composeHotkey": "Alt+Shift+A" }),
        )
        .unwrap();
        let home = core.config_dir.join("home");
        let path = export_config(&core, &home).unwrap();

        let other = open_in("import");
        let imported = import_config(&other, Path::new(&path)).unwrap();
        assert_eq!(imported.settings.theme, "dark");
        assert!(imported.effects.hotkeys);
        assert_eq!(*other.settings.lock().unwrap(), imported.settings);
    }

    #[test]
    fn an_import_rejected_by_the_settings_patch_writes_no_file_at_all() {
        // 内存里有一条已存在的局域网 http 覆盖（老配置，放行），导出包原样带着它，
        // 预校验对着内存放行；之后设置文件被外部改掉、去掉了这条覆盖，
        // 保存时对着重载的文件校验就会拒绝。这时术语表也不能已经被覆盖。
        let core = open_in("import-rejected");
        std::fs::write(
            Settings::path_in(&core.config_dir),
            r#"{"providerBaseUrls":{"openai":"http://10.0.0.1/v1"}}"#,
        )
        .unwrap();
        *core.settings.lock().unwrap() = Settings::load(&core.config_dir);
        let glossaries = core
            .config_dir
            .join(crate::legacy_glossaries::GLOSSARIES_FILE);
        std::fs::write(&glossaries, r#"{"lists":[{"id":"local"}]}"#).unwrap();
        let bundle = config_io::export_json(
            &core.settings.lock().unwrap(),
            &Glossaries {
                lists: vec![serde_json::json!({ "id": "imported" })],
                ..Glossaries::default()
            },
        );
        let path = core.config_dir.join("bundle.json");
        std::fs::write(&path, bundle).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(Settings::path_in(&core.config_dir), "{}").unwrap();
        let glossary_bytes = std::fs::read(&glossaries).unwrap();
        let settings_bytes = std::fs::read(Settings::path_in(&core.config_dir)).unwrap();

        assert!(import_config(&core, &path).is_err());
        assert_eq!(
            std::fs::read(&glossaries).unwrap(),
            glossary_bytes,
            "术语表不变"
        );
        assert_eq!(
            std::fs::read(Settings::path_in(&core.config_dir)).unwrap(),
            settings_bytes,
            "设置文件不变"
        );
    }

    #[test]
    fn short_text_is_returned_as_is() {
        assert_eq!(trim_display("  hello  ", 60), "hello");
        assert_eq!(trim_display("你好", 60), "你好");
    }

    #[test]
    fn newlines_become_spaces_so_the_panel_stays_one_line() {
        // 面板里每条只有一行的高度；换行会把四条最近翻译撑成一屏。
        assert_eq!(trim_display("第一行\n第二行", 60), "第一行 第二行");
    }

    #[test]
    fn long_text_is_cut_by_characters_not_bytes() {
        // 按字节切会把一个汉字切成半个——那是乱码，不是省略。
        let long = "一".repeat(100);
        let trimmed = trim_display(&long, 10);
        assert_eq!(trimmed.chars().count(), 10, "含省略号共 10 个字符");
        assert!(trimmed.ends_with('…'));
        assert!(trimmed.chars().all(|c| c == '一' || c == '…'));
    }

    #[test]
    fn a_zero_limit_does_not_panic() {
        assert_eq!(trim_display("abc", 0), "…");
    }
}
