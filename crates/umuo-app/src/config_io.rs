//! 配置导入导出（PRD §6.4）。
//!
//! **导出的东西里没有、也永远不会有 API Key。** Key 只存在系统 Keychain 里，
//! 设置与术语表都不含它——所以「导出默认不含 Key」不是这一层的一个开关选项，
//! 而是数据结构的必然结果。有测试守着这条不变量（新增字段踩到它会立刻失败）。
//!
//! 代价要说清楚：**换机器导入后要重新填 Key**。界面必须讲这一句，
//! 否则用户会以为"导入完了但用不了"是坏了。
//!
//! 为什么没有「勾选包含 Key 并加密」：加密导出的安全性取决于口令强度与实现细节，
//! 而它的收益只是省一次粘贴。在没做好之前不提供，比提供一个半成品安全
//! （见 `docs/PRD-CONFORMANCE.md` 的未对齐清单）。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::legacy_glossaries::Glossaries;
use crate::settings::Settings;

/// 导出格式的版本。读到的比它新就拒绝——未来字段可能带语义，硬啃会出怪问题。
pub const BUNDLE_VERSION: u32 = 1;

/// 导出的默认文件名。稳定且会被覆盖：用户与我们只认这一个位置。
pub const EXPORT_FILE: &str = "umuo-config.json";

/// 导出包。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub version: u32,
    /// 导出这个包的内核 crate 版本（`CARGO_PKG_VERSION`，即 workspace 版本），
    /// **不是**发布版本号（`v0.2.<运行序号>` 只写在 Swift 宿主的 Info.plist 里）。
    /// **只用于事后排查**，不参与任何判断——
    /// 版本号参与逻辑就会变成一道随时会拦人的墙。
    pub app_version: String,
    pub settings: Settings,
    pub glossaries: Glossaries,
    /// 本版本不认识的字段，见 [`umuo_core::UnknownFields`]。
    #[serde(flatten)]
    pub extra: umuo_core::UnknownFields,
}

/// 导入摘要：**应用之前**给用户确认的那张单子，也是导入后的提示。
///
/// 只要导入会覆盖掉、或会带来用户意料不到的副作用，就必须在这里看得见。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub provider_id: String,
    pub target_lang: String,
    pub custom_style_count: usize,
    pub glossary_count: usize,
    pub bundle_version: u32,
    /// 这次导入改动了的端点：`供应商 id → 新地址`（自定义端点记作 `custom`，空串 = 删掉覆盖）。
    ///
    /// 端点会收到 API Key，一份别人分享的配置悄悄换掉它，界面上必须看得见。
    pub endpoint_changes: Vec<(String, String)>,
    /// 取词黑名单新增、移除的条目。移除意味着某个应用里的选中内容从此会被读取并发给云端。
    pub blacklist_added: Vec<String>,
    pub blacklist_removed: Vec<String>,
    /// 本机现有的自建风格与术语表条数：导入按文件**整份替换**，这些都会被覆盖。
    pub replaced_custom_style_count: usize,
    pub replaced_glossary_count: usize,
    /// 历史保留天数被改短时的新值：应用当场就删掉超期的历史。
    pub retention_shortened_to: Option<u32>,
    /// 代理变了时的新设置（`custom` 时是地址，否则是模式名）。所有请求、连同 Key 都走它。
    pub proxy_change: Option<String>,
    /// 全局快捷键有变化。
    pub hotkeys_changed: bool,
}

/// 对比当前设置与（已规范化的）导入设置，生成摘要。纯函数，便于测试。
pub fn summarize(
    current: &Settings,
    current_glossaries: &Glossaries,
    incoming: &Settings,
    glossaries: &Glossaries,
    bundle_version: u32,
) -> ImportSummary {
    let mut endpoint_changes = Vec::new();
    if current.custom_base_url.trim() != incoming.custom_base_url.trim() {
        endpoint_changes.push((
            "custom".to_string(),
            incoming.custom_base_url.trim().to_string(),
        ));
    }
    let ids: std::collections::BTreeSet<&String> = current
        .provider_base_urls
        .keys()
        .chain(incoming.provider_base_urls.keys())
        .collect();
    for id in ids {
        let before = current.provider_base_urls.get(id).map_or("", |u| u.trim());
        let after = incoming.provider_base_urls.get(id).map_or("", |u| u.trim());
        if before != after {
            endpoint_changes.push((id.clone(), after.to_string()));
        }
    }

    let contains =
        |list: &[String], name: &String| list.iter().any(|x| x.eq_ignore_ascii_case(name));
    ImportSummary {
        provider_id: incoming.provider_id.clone(),
        target_lang: incoming.target_lang.clone(),
        custom_style_count: incoming.custom_styles.len(),
        glossary_count: glossaries.lists.len(),
        bundle_version,
        endpoint_changes,
        blacklist_added: incoming
            .selection_blacklist
            .iter()
            .filter(|name| !contains(&current.selection_blacklist, name))
            .cloned()
            .collect(),
        blacklist_removed: current
            .selection_blacklist
            .iter()
            .filter(|name| !contains(&incoming.selection_blacklist, name))
            .cloned()
            .collect(),
        replaced_custom_style_count: current.custom_styles.len(),
        replaced_glossary_count: current_glossaries.lists.len(),
        retention_shortened_to: (incoming.history_retention_days < current.history_retention_days)
            .then_some(incoming.history_retention_days),
        proxy_change: (current.proxy_mode != incoming.proxy_mode
            || current.proxy_url.trim() != incoming.proxy_url.trim())
        .then(|| {
            if incoming.proxy_mode == "custom" {
                incoming.proxy_url.trim().to_string()
            } else {
                incoming.proxy_mode.clone()
            }
        }),
        hotkeys_changed: current.hotkeys() != incoming.hotkeys(),
    }
}

/// 把当前设置与术语表序列化成导出文件的内容。
///
/// 设置里本版本不认识的字段照常导出，但**名字像凭据的去掉**：Key 只在 Keychain，
/// 手改配置或别的版本误写进 `extra` 的东西不能随一个会被分享的文件流出去。
pub fn export_json(settings: &Settings, glossaries: &Glossaries) -> String {
    let mut settings = settings.clone();
    settings.strip_secret_looking_extras();
    let bundle = Bundle {
        version: BUNDLE_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        settings,
        glossaries: glossaries.clone(),
        extra: umuo_core::UnknownFields::new(),
    };
    // 结构里只有字符串、数字与 JSON 值，序列化不会失败
    serde_json::to_string_pretty(&bundle).expect("导出包一定可序列化")
}

/// 键名看起来像凭据：按 camelCase、`_`、`-` 拆成词，整词是凭据类名词、相邻的 `api` + `key`，
/// 或以 `token` 结尾才算。
///
/// 每次保存设置都会按它剔除未知字段，所以不能用子串匹配：新版本写的 `maxOutputTokens`、
/// `secretaryMode` 会被旧版本一保存就删掉，违反「保留未知字段」。
/// 宁可多去掉一个未知字段，也不能让 Key 进配置文件或导出文件——凭据类名词之外的词照常保留。
pub(crate) fn looks_like_a_secret(key: &str) -> bool {
    const SECRET_WORDS: &[&str] = &[
        "apikey",
        "secret",
        "password",
        "passwd",
        "credential",
        "credentials",
        "bearer",
    ];
    let words = split_words(key);
    words
        .iter()
        .any(|word| SECRET_WORDS.contains(&word.as_str()))
        || words
            .windows(2)
            .any(|pair| pair[0] == "api" && pair[1] == "key")
        // token 在最后才是凭据（authToken、accessToken）；在前面多半是模型的 token（tokenBudget、tokenLimit）
        || words.last().is_some_and(|word| word == "token")
}

/// 把键名拆成小写的词：`openaiApiKey` → openai / api / key，`APIKey` → api / key，`auth_token` → auth / token。
fn split_words(key: &str) -> Vec<String> {
    let chars: Vec<char> = key.chars().collect();
    let mut words = Vec::new();
    let mut word = String::new();
    for (i, &ch) in chars.iter().enumerate() {
        if !ch.is_alphanumeric() {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
            continue;
        }
        let prev = i.checked_sub(1).map(|j| chars[j]);
        let next = chars.get(i + 1).copied();
        // 小写→大写是新词（apiKey）；连续大写里最后一个、后面跟小写的也是新词（APIKey 的 K）。
        let boundary = ch.is_uppercase()
            && prev.is_some_and(|p| {
                p.is_lowercase()
                    || p.is_ascii_digit()
                    || (p.is_uppercase() && next.is_some_and(char::is_lowercase))
            });
        if boundary && !word.is_empty() {
            words.push(std::mem::take(&mut word));
        }
        word.extend(ch.to_lowercase());
    }
    if !word.is_empty() {
        words.push(word);
    }
    words
}

/// 校验并准备好的导入内容，还没写进任何文件。
pub struct PreparedImport {
    pub settings: Settings,
    pub glossaries: Glossaries,
    pub summary: ImportSummary,
}

/// 解析导出文件：版本校验、合并未知字段、规范化与校验、生成摘要。**不写任何文件**：
/// 不合法的包整份拒绝，不会只导进来一半。
///
/// 设置与术语表顶层本版本不认识的字段（`extra`）按键合并：文件里的覆盖本地同名键，
/// 本地独有的保留——导入一份旧版本导出的配置，不能抹掉这台机器上新版本写的字段。
/// 嵌套的列表（自建预设、术语表等）按文件整份替换，它们的未知字段跟着文件走。
pub fn prepare_import(
    raw: &str,
    current: &Settings,
    current_glossaries: &Glossaries,
) -> Result<PreparedImport, String> {
    let bundle: Bundle =
        serde_json::from_str(raw).map_err(|e| format!("不是有效的 umuo 配置文件：{e}"))?;
    check_version(bundle.version)?;
    let mut settings = bundle.settings;
    keep_local_unknown_fields(&mut settings.extra, &current.extra);
    settings.prepare_for_save(current)?;
    let mut glossaries = bundle.glossaries;
    keep_local_unknown_fields(&mut glossaries.extra, &current_glossaries.extra);
    let summary = summarize(
        current,
        current_glossaries,
        &settings,
        &glossaries,
        bundle.version,
    );
    Ok(PreparedImport {
        settings,
        glossaries,
        summary,
    })
}

fn keep_local_unknown_fields(
    incoming: &mut umuo_core::UnknownFields,
    local: &umuo_core::UnknownFields,
) {
    for (key, value) in local {
        incoming.entry(key.clone()).or_insert_with(|| value.clone());
    }
}

/// 导出路径：`<home>/Downloads/umuo-config.json`。
///
/// 导出不弹保存面板：固定位置 + 界面显示完整路径，用户照样找得到；
/// 导入由 Swift 宿主的打开面板选文件，所以也不限于这一处。
pub fn export_path_in(home: &Path) -> PathBuf {
    home.join("Downloads").join(EXPORT_FILE)
}

/// 版本检查。纯函数，便于测试"未来版本要被拒绝"。
pub fn check_version(found: u32) -> Result<(), String> {
    if found > BUNDLE_VERSION {
        return Err(format!(
            "这个配置文件来自更新的版本（格式 v{found}，本机最高支持 v{BUNDLE_VERSION}）。请先升级 umuo。"
        ));
    }
    if found == 0 {
        return Err("配置文件缺少版本号，可能不是 umuo 导出的。".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::legacy_glossaries::Glossaries;

    fn settings_with_extra(pairs: serde_json::Value) -> Settings {
        Settings {
            extra: pairs.as_object().unwrap().clone(),
            ..Settings::default()
        }
    }

    #[test]
    fn retired_data_round_trips_without_validation_or_normalization() {
        // 旧编辑器会拒绝的重复 id、空指令、未知形状均只保留，不阻止用户保存其它设置。
        let settings = Settings {
            style_id: "old-style".into(),
            custom_styles: vec![
                serde_json::json!({"id":"duplicate", "instruction":"", "temperature":9, "future":[1]}),
                serde_json::json!({"id":"duplicate", "future":{"x":true}}),
            ],
            ..Settings::default()
        };
        let glossaries: Glossaries = serde_json::from_value(serde_json::json!({
            "lists":[{"id":"old", "entries":[{"source":"x","future":true}], "color":"teal"}],
            "futureTop":[2]
        }))
        .unwrap();
        let exported = export_json(&settings, &glossaries);
        let mut prepared =
            prepare_import(&exported, &Settings::default(), &Glossaries::default()).unwrap();
        prepared.settings.theme = "dark".into();
        prepared.settings.prepare_for_save(&settings).unwrap();
        assert_eq!(prepared.settings.style_id, settings.style_id);
        assert_eq!(prepared.settings.custom_styles, settings.custom_styles);
        assert_eq!(prepared.glossaries, glossaries);
    }

    #[test]
    fn unknown_fields_survive_export_then_import() {
        let mut glossaries = Glossaries::default();
        glossaries.extra.insert("futureTop".into(), 1.into());
        let exported = export_json(
            &settings_with_extra(serde_json::json!({"futureField":{"x":[1,2]}})),
            &glossaries,
        );

        let prepared =
            prepare_import(&exported, &Settings::default(), &Glossaries::default()).unwrap();
        assert_eq!(
            prepared.settings.extra["futureField"],
            serde_json::json!({"x":[1,2]})
        );
        assert_eq!(prepared.glossaries.extra["futureTop"], 1);
    }

    #[test]
    fn importing_keeps_local_unknown_fields_and_lets_the_file_win_on_clashes() {
        // 导入一份旧版本导出的配置，不能抹掉这台机器上新版本写的字段
        let mut file_glossaries = Glossaries::default();
        file_glossaries
            .extra
            .insert("shared".into(), "from-file".into());
        let exported = export_json(
            &settings_with_extra(serde_json::json!({"shared":"from-file","onlyInFile":1})),
            &file_glossaries,
        );
        let mut local_glossaries = Glossaries::default();
        local_glossaries
            .extra
            .insert("shared".into(), "local".into());
        local_glossaries.extra.insert("onlyLocal".into(), 2.into());
        let current = settings_with_extra(serde_json::json!({"shared":"local","onlyLocal":2}));

        let prepared = prepare_import(&exported, &current, &local_glossaries).unwrap();
        for extra in [&prepared.settings.extra, &prepared.glossaries.extra] {
            assert_eq!(extra["shared"], "from-file");
            assert_eq!(extra["onlyLocal"], 2);
        }
        assert_eq!(prepared.settings.extra["onlyInFile"], 1);
    }

    #[test]
    fn unknown_top_level_fields_of_the_bundle_are_accepted() {
        // 新版本导出的包多了顶层字段（例如 exportedBy），旧版本照样能导入
        let mut bundle: serde_json::Value =
            serde_json::from_str(&export_json(&Settings::default(), &Glossaries::default()))
                .unwrap();
        bundle["exportedBy"] = "swift".into();
        let parsed: Bundle = serde_json::from_value(bundle).unwrap();
        assert_eq!(parsed.extra["exportedBy"], "swift");
    }

    #[test]
    fn unknown_fields_that_look_like_secrets_are_not_exported() {
        // Key 只在 Keychain；手改或别的版本误写进来的也不能随导出文件流出去
        let settings = settings_with_extra(serde_json::json!({
            "openaiApiKey":"sk-x","authToken":"t","clientSecret":"s","password":"p",
            "futureHotkeyHint":"ok"
        }));
        let exported: serde_json::Value =
            serde_json::from_str(&export_json(&settings, &Glossaries::default())).unwrap();
        let keys: Vec<&String> = exported["settings"].as_object().unwrap().keys().collect();
        for secret in ["openaiApiKey", "authToken", "clientSecret", "password"] {
            assert!(!keys.iter().any(|k| *k == secret), "{secret} 不该被导出");
        }
        assert_eq!(exported["settings"]["futureHotkeyHint"], "ok");
    }

    #[test]
    fn secret_detection_matches_whole_words_not_substrings() {
        for secret in [
            "apiKey",
            "openaiApiKey",
            "APIKey",
            "api_key",
            "apikey",
            "authToken",
            "access-token",
            "clientSecret",
            "password",
            "proxyPasswd",
            "awsCredentials",
            "bearer",
        ] {
            assert!(looks_like_a_secret(secret), "{secret} 应判为凭据");
        }
        // 只是含这些字母的普通字段：每次保存都会过这道判定，误判就会删掉别的版本写的设置
        for plain in [
            "maxOutputTokens",
            "tokenBudget",
            "tokenLimit",
            "secretaryMode",
            "hotkey",
            "keyboardLayout",
            "passwordlessHint",
            "futureHotkeyHint",
        ] {
            assert!(!looks_like_a_secret(plain), "{plain} 不该判为凭据");
        }
    }

    fn bundle() -> Bundle {
        Bundle {
            extra: Default::default(),
            version: BUNDLE_VERSION,
            app_version: "0.1.0".to_string(),
            settings: Settings::default(),
            glossaries: Glossaries::default(),
        }
    }

    #[test]
    fn a_bundle_survives_a_round_trip() {
        let original = bundle();
        let json = serde_json::to_string_pretty(&original).unwrap();
        assert_eq!(serde_json::from_str::<Bundle>(&json).unwrap(), original);
    }

    #[test]
    fn the_exported_file_never_has_a_credential_field() {
        // 与 settings 的守卫同一不变量，但**检查字段名**而不是全文子串——
        // 黑名单的值里有 "1Password"（我们拒绝读取的应用名），按值匹配会把
        // 合法内容误判成泄密（这条测试第一版就是这么挂的）。
        let value = serde_json::to_value(bundle()).unwrap();
        let mut keys = Vec::new();
        fn collect(value: &serde_json::Value, out: &mut Vec<String>) {
            match value {
                serde_json::Value::Object(map) => {
                    for (k, v) in map {
                        out.push(k.clone());
                        collect(v, out);
                    }
                }
                serde_json::Value::Array(items) => {
                    for item in items {
                        collect(item, out);
                    }
                }
                _ => {}
            }
        }
        collect(&value, &mut keys);

        for key in &keys {
            let lower = key.to_lowercase();
            for forbidden in ["apikey", "api_key", "secret", "token", "password", "bearer"] {
                assert!(
                    !lower.contains(forbidden),
                    "导出文件里出现了疑似凭据字段 {key}（含 {forbidden}）"
                );
            }
        }
    }

    #[test]
    fn a_future_version_is_refused_with_an_actionable_message() {
        let error = check_version(BUNDLE_VERSION + 1).unwrap_err();
        assert!(error.contains("升级"), "错误信息要给出下一步：{error}");
    }

    #[test]
    fn the_current_version_is_accepted() {
        assert!(check_version(BUNDLE_VERSION).is_ok());
        // 旧版本可以读：字段只增不改语义。
        assert!(check_version(1).is_ok());
    }

    #[test]
    fn a_file_without_a_version_is_refused() {
        // `version` 是必填字段，缺了在解析时就被拒；显式写成 0 的多半是别的 JSON 被误当成配置。
        assert!(check_version(0).is_err());
    }

    #[test]
    fn the_export_path_is_predictable() {
        let path = export_path_in(Path::new("/Users/someone"));
        assert_eq!(
            path,
            PathBuf::from("/Users/someone/Downloads/umuo-config.json")
        );
    }

    #[test]
    fn the_summary_lists_endpoint_and_blacklist_changes() {
        let mut current = Settings::default();
        current
            .provider_base_urls
            .insert("azure".to_string(), "https://a.example".to_string());
        let mut incoming = current.clone();
        incoming
            .provider_base_urls
            .insert("openai".to_string(), "https://relay.example/v1".to_string());
        incoming.provider_base_urls.remove("azure");
        incoming.selection_blacklist = vec!["1PASSWORD".to_string(), "Notes".to_string()];

        let summary = summarize(
            &current,
            &Glossaries::default(),
            &incoming,
            &Glossaries::default(),
            BUNDLE_VERSION,
        );
        assert_eq!(
            summary.endpoint_changes,
            vec![
                ("azure".to_string(), String::new()),
                ("openai".to_string(), "https://relay.example/v1".to_string()),
            ]
        );
        assert_eq!(summary.blacklist_added, vec!["Notes".to_string()]);
        assert_eq!(
            summary.blacklist_removed,
            vec!["keepassxc", "bitwarden", "keychain"],
            "大小写不同的同名条目不算变化"
        );
    }

    #[test]
    fn an_identical_import_reports_no_sensitive_changes() {
        let current = Settings::default();
        let none = Glossaries::default();
        let summary = summarize(&current, &none, &current, &none, BUNDLE_VERSION);
        assert!(summary.endpoint_changes.is_empty());
        assert!(summary.blacklist_added.is_empty());
        assert!(summary.blacklist_removed.is_empty());
        assert_eq!(summary.retention_shortened_to, None);
        assert_eq!(summary.proxy_change, None);
        assert!(!summary.hotkeys_changed);
    }

    #[test]
    fn the_summary_shows_what_the_import_overwrites_and_its_side_effects() {
        // 摘要是应用前的确认单：整份替换掉的本地数据、当场删历史、换代理、换快捷键都要看得见。
        let current = Settings {
            custom_styles: vec![serde_json::json!({ "id": "mine" })],
            ..Settings::default()
        };
        let local = Glossaries {
            lists: vec![
                serde_json::json!({ "id": "a" }),
                serde_json::json!({ "id": "b" }),
            ],
            ..Glossaries::default()
        };
        let mut incoming = current.clone();
        incoming.custom_styles = Vec::new();
        incoming.history_retention_days = 7;
        incoming.proxy_mode = "custom".to_string();
        incoming.proxy_url = " http://127.0.0.1:7890 ".to_string();
        incoming.compose_hotkey = "Alt+Shift+A".to_string();

        let summary = summarize(
            &current,
            &local,
            &incoming,
            &Glossaries::default(),
            BUNDLE_VERSION,
        );
        assert_eq!(summary.replaced_custom_style_count, 1);
        assert_eq!(summary.replaced_glossary_count, 2);
        assert_eq!(summary.retention_shortened_to, Some(7));
        assert_eq!(
            summary.proxy_change.as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert!(summary.hotkeys_changed);

        incoming.history_retention_days = current.history_retention_days + 30;
        let longer = summarize(
            &current,
            &local,
            &incoming,
            &Glossaries::default(),
            BUNDLE_VERSION,
        );
        assert_eq!(longer.retention_shortened_to, None, "改长不删任何东西");
    }
}
