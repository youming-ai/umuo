//! 界面命令的业务部分：历史、用量、收藏、术语表、配置导入导出、Key 状态、对比偏好、模型列表。
//!
//! 宿主的命令层只做参数转发、调这里、再做窗口操作——同一套规则 Tauri 与 SwiftUI 只写一次。
//! 这里返回的 DTO 就是 IPC 契约（`ipc.ts` 按它们的 camelCase 字段读），改字段等于改契约。
//!
//! Key 的约定不变：这里只回「配没配过」，**不回明文**。

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use umuo_core::provider::{self, ProviderKind};

use crate::config_io::ImportSummary;
use crate::glossaries::Glossaries;
use crate::settings::Settings;
use crate::settings_patch::SettingsEffects;
use crate::{config_io, history, AppCore};

const EMPTY_TEXT: &str = "没有可翻译的内容";

// ---------------------------------------------------------------- 供应商与风格

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleDto {
    pub id: String,
    pub label: String,
    /// 是否用户自建（设置页据此决定能不能删）。
    pub custom: bool,
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

/// 浮窗的「换个模型」下拉要用的：**这次真能用**的供应商。
///
/// 只列已配 Key 的（本地模型不需要 Key，也算）。把没配 Key 的也列出来，
/// 用户选中后只会得到 401——那不是「切换模型」，是踩坑。
pub fn configured_providers(core: &AppCore) -> Vec<ProviderDto> {
    provider::PROVIDERS
        .iter()
        .filter(|p| {
            !p.requires_key()
                || core
                    .host
                    .api_key(p.id)
                    .ok()
                    .flatten()
                    .is_some_and(|key| !key.trim().is_empty())
        })
        .map(to_dto)
        .collect()
}

/// 只回「配没配过」，不回明文——见模块文档。
pub fn key_status(core: &AppCore, provider_id: &str) -> Result<bool, String> {
    let secret = core.host.api_key(provider_id)?;
    Ok(secret.is_some_and(|s| !s.trim().is_empty()))
}

/// 存 Key 之前的规则（与 Tauri 的 `save_api_key` 一致）：供应商必须存在，Key 去掉首尾空白。
///
/// 返回要写进 Keychain 的值。写本身是宿主的事（Swift 直接调 Security.framework），
/// 规则放在这里是为了两个客户端只有一份：拼错的 id 会在 Keychain 里留下一条永远读不到的记录。
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

/// 翻译风格目录（内置 + 用户自建）。前端不该自己维护一份风格清单——那样两边一定会漂移。
pub fn style_catalog(core: &AppCore) -> Vec<StyleDto> {
    let settings = core.settings.lock().expect("设置锁不应中毒");
    umuo_core::prompt::all_styles(&settings.custom_styles)
        .into_iter()
        .map(|s| StyleDto {
            id: s.id,
            label: s.label,
            custom: s.custom,
        })
        .collect()
}

// ---------------------------------------------------------------- 多模型对比（PRD §5.6）

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickDto {
    pub provider_id: String,
    pub model: String,
    /// 被标记为「最佳」的次数。
    pub count: u32,
}

pub fn picks_from(core: &AppCore) -> Vec<PickDto> {
    core.stats
        .lock()
        .expect("统计锁不应中毒")
        .ranking()
        .into_iter()
        .filter_map(|(key, count)| {
            // 键里可能出现已经下架的供应商或模型名。跳过它们而不是把脏键丢给前端——
            // 前端拿一个解析不了的名字只会显示成空白一行。
            let (provider_id, model) = crate::stats::split_pick_key(&key)?;
            Some(PickDto {
                provider_id: provider_id.to_string(),
                model: model.to_string(),
                count,
            })
        })
        .collect()
}

/// 记一次「选它」。返回更新后的完整排行，前端不必再发一次查询。
pub fn record_compare_pick(
    core: &AppCore,
    provider_id: &str,
    model: &str,
) -> Result<Vec<PickDto>, String> {
    if provider::find_provider(provider_id).is_none() {
        return Err(format!("未知供应商：{provider_id}"));
    }

    {
        let mut stats = core.stats.lock().expect("统计锁不应中毒");
        stats.record_pick(provider_id, model);
        // 写盘失败不让命令失败：这一次标记仍然生效于内存，只是重启后可能丢。
        // 反过来（报错并回滚）会让用户以为没记上，实际却是记上了。
        if let Err(error) = stats.save(&core.config_dir) {
            eprintln!("umuo: 对比偏好写盘失败：{error}");
        }
    }

    Ok(picks_from(core))
}

// ---------------------------------------------------------------- 翻译历史（PRD §5.9）

/// 历史列表每页最多多少条。上限是给前端兜底的：一次拉几千条会让窗口卡住，
/// 而用户真正会翻的也就是最近这些。
const HISTORY_PAGE_MAX: u32 = 500;

/// 历史检索条件（PRD §5.9）。三者可叠加，都是 AND。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilterDto {
    pub query: Option<String>,
    pub source_app: Option<String>,
    pub model: Option<String>,
}

/// 按条件查询历史。空条件等于「显示全部」。
///
/// 检索与筛选走同一条路径：分两个命令的话，「搜索 + 筛选」这种组合要么做不到，
/// 要么就得在前端自己合并两份结果。
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
                source_app: filter.source_app,
                model: filter.model,
            },
            limit.min(HISTORY_PAGE_MAX),
            offset,
        )
    })?;
    Ok(records_to_dto(rows))
}

/// 筛选下拉的候选值：历史里**真正出现过**的来源 App 与模型。
pub fn history_facets(core: &AppCore) -> Result<umuo_store::Facets, String> {
    history::with_store(core, |store| store.facets())
}

pub fn history_delete(core: &AppCore, id: i64) -> Result<bool, String> {
    history::with_store(core, |store| store.delete(id))
}

pub fn history_clear(core: &AppCore) -> Result<usize, String> {
    history::with_store(core, |store| store.clear())
}

/// 历史的一行。与 `umuo_store::Record` 分开是为了**不让存储层的形状直接变成 IPC 契约**：
/// 表结构以后要加列时，前端不该被迫一起改。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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
    pub cost_usd: Option<f64>,
}

/// 存储层记录 → IPC 记录。
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
            cost_usd: row.entry.cost_usd,
        })
        .collect()
}

// ---------------------------------------------------------------- 用量与月度上限（PRD §5.10）

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDto {
    pub count: u32,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub unpriced: u32,
}

/// 本月的次数、token 与费用。
pub fn usage_summary(core: &AppCore) -> Result<UsageDto, String> {
    let summary = history::month_usage(core)?;
    Ok(UsageDto {
        count: summary.count,
        input_tokens: summary.input_tokens,
        output_tokens: summary.output_tokens,
        cost_usd: summary.cost_usd,
        // 价格未知的条数要如实给出：否则用户会以为「这个月只花了这么点」，
        // 而实际上一部分根本没算进总额。
        unpriced: summary.unpriced,
    })
}

/// 最近 `days` 天的按日用量。
pub fn usage_daily(core: &AppCore, days: u32) -> Result<Vec<umuo_store::DayUsage>, String> {
    // 上限给到一年：再长的窗口在界面上也读不完，而且会让查询与渲染都变慢。
    let days = days.clamp(1, 365);
    let since = history::now_unix() - i64::from(days) * 86_400;
    history::with_store(core, |store| store.usage_by_day(since))
}

/// 本月各供应商的花费，供设置页显示「已用 x / 上限 y」。
pub fn monthly_spend(core: &AppCore) -> Result<Vec<umuo_store::ProviderUsage>, String> {
    history::with_store(core, |store| {
        let since = store.month_start_unix()?;
        store.usage_by_provider(since)
    })
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickState {
    pub paused: bool,
    pub provider_label: String,
    pub model: String,
    pub recent: Vec<QuickRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickRecord {
    /// 历史记录 id。**用它当列表 key**，不要用下标——
    /// 列表会随新翻译而变化，下标当 key 会让 React 复用错行。
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
    let glossaries = core.glossaries.lock().expect("术语表锁不应中毒").clone();

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
    let mut glossaries = core.glossaries.lock().expect("术语表锁不应中毒");
    let prepared = config_io::prepare_import(&raw, &current, &glossaries)?;
    prepared
        .glossaries
        .save(&core.config_dir)
        .map_err(|e| e.to_string())?;
    *glossaries = prepared.glossaries;
    drop(glossaries);
    let patch = serde_json::to_value(&prepared.settings).expect("设置结构体一定可序列化");
    let (settings, effects) = core.apply_settings_patch(patch)?;
    Ok(Imported {
        summary: prepared.summary,
        settings,
        effects,
    })
}

// ---------------------------------------------------------------- 术语表（PRD §5.8）

/// 全部术语表。前端拿它渲染管理界面，**不参与翻译**（翻译用的是命中块）。
pub fn glossary_list(core: &AppCore) -> Vec<umuo_core::glossary::Glossary> {
    core.glossaries
        .lock()
        .expect("术语表锁不应中毒")
        .lists
        .clone()
}

/// 保存（新建或覆盖）一张术语表。
pub fn glossary_save(
    core: &AppCore,
    glossary: umuo_core::glossary::Glossary,
) -> Result<Vec<umuo_core::glossary::Glossary>, String> {
    edit_glossaries(core, |store| {
        store.upsert(glossary);
        Ok(store.lists.clone())
    })
}

pub fn glossary_remove(
    core: &AppCore,
    id: &str,
) -> Result<Vec<umuo_core::glossary::Glossary>, String> {
    edit_glossaries(core, |store| {
        store.remove(id);
        Ok(store.lists.clone())
    })
}

/// 从 CSV / TSV 文本导入，**替换**该表的全部条目。返回导入条数。
pub fn glossary_import(core: &AppCore, id: &str, text: &str) -> Result<usize, String> {
    edit_glossaries(core, |store| store.import_into(id, text))
}

/// 导出为 CSV 文本。
pub fn glossary_export(core: &AppCore, id: &str) -> Result<String, String> {
    core.glossaries.lock().expect("术语表锁不应中毒").export(id)
}

/// 在术语表锁里改，改成功才写盘。
fn edit_glossaries<T>(
    core: &AppCore,
    edit: impl FnOnce(&mut Glossaries) -> Result<T, String>,
) -> Result<T, String> {
    let mut store = core.glossaries.lock().expect("术语表锁不应中毒");
    let result = edit(&mut store)?;
    store.save(&core.config_dir).map_err(|e| e.to_string())?;
    Ok(result)
}

// ---------------------------------------------------------------- 收藏（PRD §5.9）

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteDto {
    pub id: i64,
    pub created_at: i64,
    pub kind: String,
    pub text: String,
    pub translation: Option<String>,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
}

/// 这段文本该算「单词」还是「句子」。
///
/// 复用核心层判定词卡模式的那条规则（≤3 个词、无句末标点、长度有限），
/// 而不是在前端再写一遍——两处各写一遍，迟早会出现「同一个词在词卡里是词、
/// 在收藏里是句」这种自相矛盾。
pub fn favorite_kind_for(text: &str) -> umuo_store::FavoriteKind {
    if umuo_core::word_card::is_word_mode(text) {
        umuo_store::FavoriteKind::Word
    } else {
        umuo_store::FavoriteKind::Sentence
    }
}

/// 切换收藏状态，返回**切换之后**的状态（true = 现在已收藏）。
///
/// 返回新状态而不是 `()`：星标按钮需要知道最终是亮的还是灭的。
/// 让前端自己做乐观更新再与服务端对账，是这类小交互里最容易出现不一致的写法。
pub fn favorite_toggle(
    core: &AppCore,
    text: &str,
    translation: Option<String>,
) -> Result<bool, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err(EMPTY_TEXT.to_string());
    }
    let kind = favorite_kind_for(&trimmed);

    history::with_store(core, |store| {
        // 按文本而不是 (kind, text) 判断：判定规则改过，旧收藏的 kind 可能与现在算出的不同。
        if store.is_text_favorited(&trimmed)? {
            store.remove_favorites_by_text_any_kind(&trimmed)?;
            Ok(false)
        } else {
            store.add_favorite(&umuo_store::NewFavorite {
                created_at: history::now_unix(),
                kind,
                text: trimmed,
                translation,
                source_lang: None,
                target_lang: None,
            })?;
            Ok(true)
        }
    })
}

/// 给定若干条文本，返回它们**当前**是否已被收藏。
///
/// 历史列表一屏有一百来行，逐行去问一次是 100 次 IPC 往返；
/// 这里一次问完。判定规则仍然在 Rust 侧，前端不需要知道 kind 怎么算。
pub fn favorites_status(core: &AppCore, texts: &[String]) -> Result<Vec<bool>, String> {
    history::with_store(core, |store| {
        texts
            .iter()
            .map(|text| {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return Ok(false);
                }
                store.is_text_favorited(trimmed)
            })
            .collect::<Result<Vec<bool>, umuo_store::StoreError>>()
    })
}

pub fn favorites_list(core: &AppCore, limit: u32, offset: u32) -> Result<Vec<FavoriteDto>, String> {
    let rows = history::with_store(core, |store| {
        store.favorites(limit.min(HISTORY_PAGE_MAX), offset)
    })?;
    Ok(rows
        .into_iter()
        .map(|row| FavoriteDto {
            id: row.id,
            created_at: row.created_at,
            kind: match row.kind {
                umuo_store::FavoriteKind::Word => "word".to_string(),
                umuo_store::FavoriteKind::Sentence => "sentence".to_string(),
            },
            text: row.text,
            translation: row.translation,
            source_lang: row.source_lang,
            target_lang: row.target_lang,
        })
        .collect())
}

pub fn favorite_remove(core: &AppCore, id: i64) -> Result<bool, String> {
    history::with_store(core, |store| store.remove_favorite(id))
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
    fn configured_providers_are_the_ones_with_a_key_plus_local_models() {
        let core = open_in("configured");
        let ids: Vec<String> = configured_providers(&core)
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert!(ids.contains(&"deepseek".to_string()));
        assert!(!ids.contains(&"openai".to_string()));
        assert!(ids.contains(&"ollama".to_string()), "本地模型不要 Key");
    }

    #[test]
    fn a_compare_pick_for_an_unknown_provider_is_rejected_and_a_known_one_is_ranked() {
        let core = open_in("picks");
        assert!(record_compare_pick(&core, "nope", "m").is_err());
        let picks = record_compare_pick(&core, "deepseek", "deepseek-chat").unwrap();
        assert_eq!(picks.len(), 1);
        assert_eq!(picks[0].count, 1);
        assert_eq!(picks_from(&core).len(), 1);
    }

    #[test]
    fn favorites_toggle_on_and_off_by_text() {
        let core = open_in("favorites");
        assert!(favorite_toggle(&core, "  hello  ", None).unwrap());
        assert_eq!(
            favorites_status(&core, &["hello".into(), "".into(), "other".into()]).unwrap(),
            vec![true, false, false]
        );
        assert_eq!(favorites_list(&core, 10, 0).unwrap()[0].kind, "word");
        assert!(!favorite_toggle(&core, "hello", None).unwrap());
        assert!(favorite_toggle(&core, "   ", None).is_err());
    }

    #[test]
    fn a_failed_glossary_import_does_not_write_the_file() {
        let core = open_in("glossary");
        let glossary = umuo_core::glossary::Glossary {
            id: "g1".into(),
            name: "术语".into(),
            source_lang: String::new(),
            target_lang: String::new(),
            entries: Vec::new(),
            extra: Default::default(),
        };
        assert_eq!(glossary_save(&core, glossary).unwrap().len(), 1);
        let saved = std::fs::read(core.config_dir.join("glossaries.json")).unwrap();
        assert!(glossary_import(&core, "missing", "a,b").is_err());
        assert_eq!(
            std::fs::read(core.config_dir.join("glossaries.json")).unwrap(),
            saved
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
