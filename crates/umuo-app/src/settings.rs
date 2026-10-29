//! 应用设置的持久化。
//!
//! **这个文件里没有 API Key，将来也不许有。** Key 由 [`umuo_platform::SecretStore`]
//! 存进系统凭据存储，这里只放「不敏感但需要记住」的偏好。
//! 结构体上有一条测试专门守这个不变量（`settings_json_never_contains_a_key`）。

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const SETTINGS_FILE: &str = "settings.json";

/// 默认主题：跟随系统。
fn default_theme() -> String {
    "system".to_string()
}

/// 取词黑名单的默认值：常见密码管理器。
///
/// 这是**安全默认**，不是预设立场——用户随时可以在设置里增删。
fn default_selection_blacklist() -> Vec<String> {
    ["1password", "keepassxc", "bitwarden", "keychain"]
        .iter()
        .map(|name| name.to_string())
        .collect()
}

/// 把设置界面的多行文本解析成黑名单：去空白行、去首尾空白、大小写不敏感去重。
///
/// 返回**原始大小写**（界面上显示用户输入的原样），匹配时再统一小写。
pub fn parse_selection_blacklist(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(trimmed))
        {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

/// 界面缩放的合法档位。任意值会让排版在各种窗口里各自坏掉，
/// 所以只给四档——覆盖"小一点/正常/大一点/很大"。
pub const UI_SCALES: [f64; 4] = [0.85, 1.0, 1.25, 1.5];

/// 归一化时找最近档位用的有序副本（UI_SCALES 本身已按升序书写）。
const UI_SCALES_BY_VALUE: [f64; 4] = UI_SCALES;

/// 默认界面缩放：1.0（跟随系统）。
fn default_ui_scale() -> f64 {
    1.0
}

/// 默认代理模式：跟随系统。用户没配过代理时，系统代理仍然生效——
/// 那正是「跟随系统」的意义。
fn default_proxy_mode() -> String {
    "system".to_string()
}

/// 默认目标语言规则：固定（与 PRD §5.4 的默认一致——「按 App 记忆」是可选行为）。
fn default_target_lang_mode() -> String {
    "fixed".to_string()
}

/// 默认界面语言：跟随系统（PRD §8「面向全球」）。
fn default_locale() -> String {
    "system".to_string()
}

// 不派生 `Eq`：里面含 `f32`（自建预设的温度），而浮点不满足自反性
// （`NaN != NaN`），声称 `Eq` 是错的。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub provider_id: String,
    /// 为空表示「用该供应商的默认模型」。
    pub model: String,
    /// 第一目标语言（PRD §7.3「语言」）。
    pub target_lang: String,
    /// 第二目标语言：源语言与第一目标语言相同时改用它（PRD §5.2）。
    pub secondary_target_lang: String,
    /// 旧选中风格，仅保留配置兼容，不参与请求或新历史。
    pub style_id: String,
    /// 划词翻译的全局快捷键。默认 ⌃⌃（连按两下 ⌃），与 Trancy Air 一致，
    /// 降低从同类工具迁过来的成本。旧版默认是 ⌥D（PRD §7.2），老用户的设置文件里仍是它。
    pub selection_hotkey: String,
    /// 输入框原地替换（静默翻译）的全局快捷键，默认 ⌥⌥（连按两下 ⌥）。
    pub silent_replace_hotkey: String,
    /// 撰写窗的全局快捷键，默认 ⌥⌘A。
    pub compose_hotkey: String,
    /// 旧对比快捷键，仅保留读写兼容，不再注册。
    pub compare_hotkey: String,
    /// 截图 OCR 的全局快捷键，默认 ⌥⌘O。
    pub ocr_hotkey: String,
    /// 静默 OCR（识别后只复制原文，不翻译不弹窗）的快捷键，默认 ⌥⇧O（PRD §5.5）。
    /// 旧静默 OCR 快捷键，仅保留读写兼容，不再注册。
    pub ocr_silent_hotkey: String,
    /// 朗读选中文本（PRD §7.2）。
    /// 旧独立朗读快捷键，仅保留读写兼容；结果朗读仍可用。
    pub speak_hotkey: String,
    /// 自定义 OpenAI 兼容端点的 Base URL（PRD §6.1最后一行）。只在选「自定义端点」时用。
    pub custom_base_url: String,
    /// 逐供应商的 Base URL 覆盖。
    ///
    /// Azure **必须**在这里填资源终结点（没有默认值可猜）；其它供应商留空即用内置地址。
    /// 做成一个 map 而不是给 Azure 加一个专用字段：将来"让 OpenAI 走中转"这类需求
    /// 会落在同一个地方，不必再加一个字段。
    #[serde(default)]
    pub provider_base_urls: std::collections::BTreeMap<String, String>,
    /// 主题（PRD §7.3 通用）：`system` / `light` / `dark` / `highContrast`。
    ///
    /// 存成字符串而不是枚举：手改配置、或旧版本写进来的值都不该让设置文件读不出来。
    /// 认不出来的值由客户端的 `resolveTheme` 回落「跟随系统」。
    #[serde(default = "default_theme")]
    pub theme: String,
    /// 母语（PRD §7.3 语言组）。
    ///
    /// 它的真实作用在"源语言检测不出来"时：作为源语言的假设，
    /// 让"撞车换第二目标语言"的规则能正常工作。留空 = 不做假设。
    #[serde(default)]
    pub native_lang: String,
    /// 取词黑名单（PRD §7.3）：这些应用里**连读都不读**。
    ///
    /// 把密码管理器里选中的内容发给云端是安全事故，不是体验问题——
    /// 所以判定的位置在**读取之前**（见 translator 的取词路径）。
    /// 匹配不区分大小写、且支持双向包含（填 "keepass" 也能命中 KeePassXC）。
    #[serde(default = "default_selection_blacklist")]
    pub selection_blacklist: Vec<String>,
    /// 界面缩放（PRD §7.3 通用）。1.0 = 跟随系统；只接受预设档位。
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f64,
    /// 代理模式（PRD §8）：`system`（默认，跟随系统）/ `none`（直连）/ `custom`。
    #[serde(default = "default_proxy_mode")]
    pub proxy_mode: String,
    /// 自定义代理地址（`proxy_mode = "custom"` 时使用）。
    #[serde(default)]
    pub proxy_url: String,
    /// 目标语言规则（PRD §5.4）：`fixed`（固定，默认）或 `perApp`（按 App 记忆）。
    #[serde(default = "default_target_lang_mode")]
    pub target_lang_mode: String,
    /// 按 App 记住的目标语言：来源 App 名 → 语言码。
    ///
    /// 只在 `perApp` 模式下生效，写入时机是**用户手动为某个 App 选过语言**之后。
    /// 不做隐式学习：用户得能看见、也能删掉我们记住了什么。
    #[serde(default)]
    pub app_target_langs: std::collections::BTreeMap<String, String>,
    /// 界面语言（PRD §8 / §7.3 通用）：`system` / `zh-CN` / `zh-TW` / `en` / `ja`。
    ///
    /// 与主题同样存字符串：手改配置或旧版本写进来的值都不该让设置读不出来。
    #[serde(default = "default_locale")]
    pub locale: String,
    /// 开机启动（PRD §7.3 通用）。macOS 上用 LaunchAgent 实现。
    #[serde(default)]
    pub launch_at_login: bool,
    /// 隐私模式（PRD §5.9 / §7.3）：开启期间**一次翻译都不写入历史**。
    ///
    /// 与 `history_enabled` 的区别是语义而不是实现：前者是长期偏好（我不要历史），
    /// 后者是临时状态（这几个小时别记）。用户不会为了「先别记」去改长期偏好再改回来。
    #[serde(default)]
    pub privacy_mode: bool,
    /// 首次启动引导是否已经走完（PRD §7.4）。
    ///
    /// 存成设置项而不是「有没有配 Key」：用户可能明确选择先跳过，
    /// 下次启动不该又把引导糊到他脸上。
    #[serde(default)]
    pub onboarding_done: bool,
    /// 旧自建预设的完整 JSON，仅保留配置转移，不再解释或规范化。
    #[serde(default)]
    pub custom_styles: Vec<serde_json::Value>,
    /// 旧对比供应商列表，仅保留读写兼容，不参与请求。
    pub compare_providers: Vec<String>,
    /// 是否记录翻译历史（PRD §5.9）。关掉之后**一条都不写**。
    pub history_enabled: bool,
    /// 历史保留天数（PRD §5.9，默认 90）。**0 = 不自动清理**。
    pub history_retention_days: u32,
    /// 本版本不认识的字段，见 [`umuo_core::UnknownFields`]。
    #[serde(flatten)]
    pub extra: umuo_core::UnknownFields,
}

impl Default for Settings {
    fn default() -> Self {
        let provider = umuo_core::provider::default_provider();
        Self {
            provider_id: provider.id.to_string(),
            model: provider.default_model.to_string(),
            target_lang: "zh-CN".to_string(),
            secondary_target_lang: "en".to_string(),
            style_id: umuo_core::prompt::DEFAULT_STYLE_ID.to_string(),
            selection_hotkey: "Ctrl Ctrl".to_string(),
            silent_replace_hotkey: "Alt Alt".to_string(),
            compose_hotkey: "Alt+Cmd+A".to_string(),
            compare_hotkey: "Alt+P".to_string(),
            ocr_hotkey: "Alt+Cmd+O".to_string(),
            ocr_silent_hotkey: "Alt+Shift+O".to_string(),
            speak_hotkey: "Alt+R".to_string(),
            custom_base_url: String::new(),
            provider_base_urls: std::collections::BTreeMap::new(),
            selection_blacklist: default_selection_blacklist(),
            native_lang: String::new(),
            ui_scale: default_ui_scale(),
            proxy_mode: default_proxy_mode(),
            proxy_url: String::new(),
            target_lang_mode: default_target_lang_mode(),
            app_target_langs: std::collections::BTreeMap::new(),
            theme: default_theme(),
            locale: default_locale(),
            launch_at_login: false,
            privacy_mode: false,
            onboarding_done: false,
            custom_styles: Vec::new(),
            // 退役对比的兼容字段；新版本不读取它来发请求。
            compare_providers: Vec::new(),
            history_enabled: true,
            history_retention_days: 90,
            extra: umuo_core::UnknownFields::new(),
        }
    }
}

impl Settings {
    /// 读设置。文件不存在回落到默认值；读不动、解析不了，先备份成
    /// `settings.json.corrupt-<时间戳>` 再回落——一个坏掉的配置文件不该让客户端起不来，
    /// 也不该在下一次保存时被悄悄覆盖掉（见 [`crate::persist`]）。
    pub fn load(dir: &Path) -> Self {
        crate::persist::load_or_backup(dir, SETTINGS_FILE)
    }

    /// 原子写（临时文件 + rename）：断电时不会只剩半截文件。
    pub fn save(&self, dir: &Path) -> io::Result<()> {
        let json = serde_json::to_string_pretty(self).expect("设置结构体一定可序列化");
        crate::persist::write_atomic(&dir.join(SETTINGS_FILE), json.as_bytes())
    }

    /// 保存前的全部规范化与校验。`save_settings` 与 `import_config` 共用这一处，
    /// 导入的配置不会绕过任何一条。
    ///
    /// `previous` 是当前生效的设置：端点只校验**这次改动了的**条目——
    /// 老配置里已有的 `http://` 局域网地址不该让用户从此改不了任何设置。
    pub fn prepare_for_save(&mut self, previous: &Settings) -> Result<(), String> {
        self.strip_secret_looking_extras();
        self.normalize_selection_blacklist();
        // 代理地址当场校验：填错了要在设置页立刻说，而不是等下次翻译莫名其妙地失败。
        self.proxy_choice()?;
        self.validate_endpoints(previous)
    }

    /// 剥离未知字段中键名看起来像凭据的条目（不区分大小写，忽略 `_` 与 `-`）。
    ///
    /// Key 只存 Keychain，无论是保存补丁、导入配置还是导出配置，都不能让疑似凭据的未知字段落入配置文件。
    pub fn strip_secret_looking_extras(&mut self) {
        self.extra
            .retain(|key, _| !crate::config_io::looks_like_a_secret(key));
    }

    /// 自定义端点与需要 Key 的供应商覆盖只接受 https（本机回环地址例外）。
    ///
    /// 这些地址会收到明文的 `Authorization: Bearer <Key>`：一份别人分享的配置里写着
    /// `http://` 的中转地址，Key 就在网络上裸奔了。本机模型类供应商（Ollama / LM Studio）
    /// 不要 Key、不发鉴权头，http 没有东西可泄露；把 Ollama 跑在局域网另一台机器上
    /// （`http://192.168.1.10:11434`、`http://mac-mini.local:11434`）又很常见，
    /// 所以对它们只校验是不是合法的 http(s) 地址。
    pub fn validate_endpoints(&self, previous: &Settings) -> Result<(), String> {
        if self.custom_base_url.trim() != previous.custom_base_url.trim() {
            check_endpoint("自定义端点", &self.custom_base_url)?;
        }
        for (provider_id, url) in &self.provider_base_urls {
            if previous
                .provider_base_urls
                .get(provider_id)
                .map(|u| u.trim())
                == Some(url.trim())
            {
                continue;
            }
            let keyless =
                umuo_core::provider::find_provider(provider_id).is_some_and(|p| !p.requires_key());
            check_endpoint_with(provider_id, url, keyless)?;
        }
        Ok(())
    }

    /// 按 App 记住目标语言：在**这份**设置上只改这一条。返回是否真的变了。
    ///
    /// 调用方要在设置锁里、对**最新值**调用它——拿请求开始时的快照整份写回，
    /// 会把这期间用户在设置窗里改的东西冲掉。
    pub fn remember_app_target(&mut self, app: &str, lang: &str) -> bool {
        let (app, lang) = (app.trim(), lang.trim());
        if app.is_empty() || lang.is_empty() {
            return false;
        }
        if self.app_target_langs.get(app).map(String::as_str) == Some(lang) {
            return false;
        }
        self.app_target_langs
            .insert(app.to_string(), lang.to_string());
        true
    }

    /// 这个应用是否在取词黑名单里。
    ///
    /// 匹配规则：不区分大小写，**双向包含**——用户填 "keepass" 就能命中
    /// "KeePassXC"，因为应用的实际名称用户未必记得准。
    pub fn is_selection_blocked(&self, app_name: &str) -> bool {
        let name = app_name.trim().to_lowercase();
        if name.is_empty() {
            return false;
        }
        self.selection_blacklist.iter().any(|entry| {
            entry.trim().to_lowercase().contains(&name)
                || name.contains(&entry.trim().to_lowercase())
        })
    }

    /// 保存前归一化黑名单：去空白、去首尾空白、大小写不敏感去重。
    ///
    pub fn normalize_selection_blacklist(&mut self) {
        self.selection_blacklist = parse_selection_blacklist(&self.selection_blacklist.join("\n"));
    }

    /// 归一化后的界面缩放：不在档位里的值取最接近的一档。
    ///
    /// 手改配置写进来的 1.1 不该被原样接受——四个窗口各自按它缩放，
    /// 排版问题会以最难归因的方式出现。
    pub fn normalized_ui_scale(&self) -> f64 {
        // 非有限值（NaN / ±inf）**显式**回默认，而不是靠数值比较碰运气——
        // inf 到四档的距离全是无穷大，min_by 会随实现返回任意一档（这条测试抓到过）。
        if !self.ui_scale.is_finite() {
            return 1.0;
        }
        UI_SCALES_BY_VALUE
            .iter()
            .copied()
            .min_by(|a, b| {
                (a - self.ui_scale)
                    .abs()
                    .total_cmp(&(b - self.ui_scale).abs())
            })
            .unwrap_or(1.0)
    }

    /// 当前四个入口的快捷键，按固定顺序；退役字段仅为旧配置兼容保留。保存设置时用它判断「快捷键是否变了、要不要重注册」。
    pub fn hotkeys(&self) -> [&str; 4] {
        [
            &self.selection_hotkey,
            &self.silent_replace_hotkey,
            &self.compose_hotkey,
            &self.ocr_hotkey,
        ]
    }

    /// 代理意图。地址不合法时返回可读的错误（PRD §8）。
    pub fn proxy_choice(&self) -> Result<umuo_core::proxy::ProxyChoice, String> {
        umuo_core::proxy::parse_proxy(&self.proxy_mode, &self.proxy_url)
    }

    /// 是否按 App 记忆目标语言（PRD §5.4）。
    pub fn uses_per_app_target(&self) -> bool {
        self.target_lang_mode.trim() == "perApp"
    }

    pub fn base_url_override(
        &self,
        provider: &umuo_core::provider::Provider,
    ) -> Result<Option<String>, umuo_core::CoreError> {
        use umuo_core::provider::ProviderKind;

        // ① 逐供应商的覆盖优先。
        if let Some(url) = self.provider_base_urls.get(provider.id) {
            if !url.trim().is_empty() {
                return Ok(Some(url.trim().to_string()));
            }
        }

        match provider.kind {
            // ② 自定义端点沿用历史字段（老配置里就在那儿）。
            ProviderKind::Custom => {
                let url = self.custom_base_url.trim();
                if url.is_empty() {
                    return Err(umuo_core::CoreError::CustomEndpointMissing);
                }
                Ok(Some(url.to_string()))
            }
            // ③ Azure 没填终结点：和自定义端点一样**拦下来**。
            //    不拦的话请求会打到一个空地址，用户只看到一条莫名其妙的网络错误。
            ProviderKind::Azure => Err(umuo_core::CoreError::AzureEndpointMissing),
            _ => Ok(None),
        }
    }

    /// 设置文件的完整路径（给「打开配置文件」之类的功能用）。
    pub fn path_in(dir: &Path) -> PathBuf {
        dir.join(SETTINGS_FILE)
    }
}

/// 单个端点的 scheme 检查。空串 = 没填，交给 `base_url_override` 去报「缺地址」。
fn check_endpoint(label: &str, url: &str) -> Result<(), String> {
    check_endpoint_with(label, url, false)
}

/// `allow_plain_http`：不发 Key 的本机模型类供应商，任意主机都可以走 http。
fn check_endpoint_with(label: &str, url: &str, allow_plain_http: bool) -> Result<(), String> {
    let candidate = url.trim();
    if candidate.is_empty() {
        return Ok(());
    }
    let parsed = reqwest::Url::parse(candidate)
        .map_err(|_| format!("{label} 的地址不是有效的 URL（当前填的是「{candidate}」）。"))?;
    let loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match parsed.scheme() {
        "https" => Ok(()),
        "http" if loopback || allow_plain_http => Ok(()),
        _ => Err(format!(
            "{label} 的地址必须以 https:// 开头（本机 localhost / 127.0.0.1 除外），\
             否则 API Key 会以明文发出（当前填的是「{candidate}」）。"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("umuo-settings-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 读进来、经保存前的规范化、存回去，再读原始 JSON。
    fn round_trip(dir: &Path, raw: &str) -> serde_json::Value {
        fs::write(dir.join(SETTINGS_FILE), raw).unwrap();
        let mut settings = Settings::load(dir);
        let previous = settings.clone();
        settings.prepare_for_save(&previous).unwrap();
        settings.save(dir).unwrap();
        serde_json::from_str(&fs::read_to_string(dir.join(SETTINGS_FILE)).unwrap()).unwrap()
    }

    #[test]
    fn unknown_top_level_fields_survive_load_and_save() {
        // 新版本（如 SwiftUI 版）写进来的字段，旧版本读进来再保存不能丢
        let dir = temp_dir("unknown-top");
        let saved = round_trip(&dir, r#"{"targetLang":"ja","futureField":{"x":[1,2]}}"#);
        assert_eq!(saved["futureField"], serde_json::json!({"x":[1,2]}));
        assert_eq!(saved["targetLang"], "ja");
    }

    #[test]
    fn unknown_fields_inside_nested_settings_survive_load_and_save() {
        let dir = temp_dir("unknown-nested");
        let saved = round_trip(
            &dir,
            r#"{
                "customStyles":[{"id":"mine","label":"我的","futureKnob":3}],
                "monthlyLimits":[{"providerId":"openai","limitUsd":5,"futureFlag":true}],
                "limitAction":"failover",
                "fallbackModels":[{"providerId":"deepseek","model":"deepseek-chat"}],
                "sceneModels":{"compare":[],"futureScene":{"providerId":"openai","model":"m"}},
                "trayIconStyle":"brand"
            }"#,
        );
        assert_eq!(saved["customStyles"][0]["futureKnob"], 3);
        // 月度上限、超限动作、备用顺序与分场景模型已退出（第三批精简），旧值原样保留、不再参与请求。
        assert_eq!(saved["monthlyLimits"][0]["futureFlag"], true);
        assert_eq!(saved["limitAction"], "failover");
        assert_eq!(saved["fallbackModels"][0]["model"], "deepseek-chat");
        // 菜单栏图标样式选择已退出（第五批精简），旧值同样原样保留。
        assert_eq!(saved["trayIconStyle"], "brand");
        assert_eq!(
            saved["sceneModels"]["futureScene"],
            serde_json::json!({"providerId":"openai","model":"m"})
        );
    }

    #[test]
    fn unknown_fields_do_not_swallow_known_ones_or_their_defaults() {
        let dir = temp_dir("unknown-known");
        fs::write(
            dir.join(SETTINGS_FILE),
            r#"{"providerId":"anthropic","futureField":1}"#,
        )
        .unwrap();
        let settings = Settings::load(&dir);
        assert_eq!(settings.provider_id, "anthropic");
        // 没写的已知字段照样回落到默认值
        assert_eq!(settings.target_lang, Settings::default().target_lang);
        assert_eq!(
            settings.extra.keys().collect::<Vec<_>>(),
            vec!["futureField"]
        );
    }

    #[test]
    fn saving_twice_with_unknown_fields_writes_identical_bytes() {
        // 两个客户端交替保存同一份文件：第二次保存不该再改动任何东西
        let dir = temp_dir("unknown-idempotent");
        round_trip(
            &dir,
            r#"{"futureField":1,"customStyles":[{"id":"s","label":"L","k":2}]}"#,
        );
        let first = fs::read_to_string(dir.join(SETTINGS_FILE)).unwrap();
        let reparsed = round_trip(&dir, &first);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&first).unwrap(),
            reparsed
        );
        assert_eq!(first, fs::read_to_string(dir.join(SETTINGS_FILE)).unwrap());
    }

    #[test]
    fn a_custom_endpoint_without_a_url_is_rejected_before_any_request() {
        let mut settings = Settings {
            provider_id: "custom".to_string(),
            ..Settings::default()
        };
        let custom = umuo_core::provider::find_provider("custom").unwrap();

        // 没填地址 → 明确报错，而不是发一个 URL 为空的请求出去。
        assert!(matches!(
            settings.base_url_override(custom),
            Err(umuo_core::CoreError::CustomEndpointMissing)
        ));

        settings.custom_base_url = "  https://gateway.internal/v1  ".to_string();
        assert_eq!(
            settings.base_url_override(custom).unwrap().as_deref(),
            Some("https://gateway.internal/v1"),
            "首尾空白应被去掉"
        );
    }

    #[test]
    fn ordinary_providers_never_use_the_custom_url() {
        // 用户在自定义端点里填的地址不该影响 OpenAI / DeepSeek 这些内置供应商。
        let settings = Settings {
            custom_base_url: "https://gateway.internal/v1".to_string(),
            ..Settings::default()
        };
        let openai = umuo_core::provider::find_provider("openai").unwrap();
        assert!(settings.base_url_override(openai).unwrap().is_none());
    }

    #[test]
    fn defaults_are_the_documented_ones() {
        let settings = Settings::default();
        assert_eq!(settings.target_lang, "zh-CN");
        assert_eq!(settings.secondary_target_lang, "en");
        // 2026-10-08 起新装默认对齐 Trancy Air（⌃⌃ / ⌥⌥ / ⌥P / ⌥⌘O），不再沿用 luca-translate 的 ⌥ 系；
        // 老用户的设置文件里已经写着各自的键位，不受影响。
        assert_eq!(settings.selection_hotkey, "Ctrl Ctrl");
        assert_eq!(settings.silent_replace_hotkey, "Alt Alt");
        assert_eq!(settings.compose_hotkey, "Alt+Cmd+A");
        assert_eq!(settings.compare_hotkey, "Alt+P");
        assert_eq!(settings.ocr_hotkey, "Alt+Cmd+O");
        assert_eq!(settings.ocr_silent_hotkey, "Alt+Shift+O");
        // PRD §7.2 的默认值：⌥R 朗读选中文本。
        assert_eq!(settings.speak_hotkey, "Alt+R");
        // PRD §8：默认跟随系统语言，而不是写死简体中文。
        assert_eq!(settings.locale, "system");
        assert!(settings.custom_base_url.is_empty(), "默认没有自定义端点");
        assert!(settings.custom_styles.is_empty(), "默认没有自建预设");
        assert!(!settings.onboarding_done, "新装的客户端应当还没走过引导");
        assert!(!settings.privacy_mode, "默认不在隐私模式");
        // PRD §5.4：默认是「固定目标语言」，按 App 记忆要用户主动开。
        assert_eq!(settings.target_lang_mode, "fixed");
        assert!(settings.app_target_langs.is_empty());
        assert!(!settings.uses_per_app_target());

        assert!(settings.compare_providers.is_empty(), "默认应为自动模式");
        assert!(settings.history_enabled, "默认记录历史");
        assert_eq!(settings.history_retention_days, 90, "PRD §5.9 默认 90 天");
        assert_eq!(settings.style_id, umuo_core::prompt::DEFAULT_STYLE_ID);
        assert_eq!(
            settings.provider_id,
            umuo_core::provider::default_provider().id
        );
    }

    #[test]
    fn active_hotkeys_are_different_out_of_the_box() {
        // 只检查当前会注册的四项，退役字段不再占用键位。
        let settings = Settings::default();
        let all = settings.hotkeys();
        let unique: std::collections::HashSet<_> = all.iter().collect();
        assert_eq!(unique.len(), all.len(), "默认快捷键不能重复：{all:?}");
    }

    #[test]
    fn round_trips_through_the_file() {
        let dir = temp_dir("roundtrip");
        let settings = Settings {
            provider_id: "deepseek".into(),
            model: "deepseek-chat".into(),
            ..Settings::default()
        };
        settings.save(&dir).unwrap();

        let loaded = Settings::load(&dir);
        assert_eq!(loaded, settings);
    }

    #[test]
    fn an_off_scale_value_snaps_to_the_nearest_step() {
        // 四个窗口各自按缩放值排版，任意值会让排版问题以最难归因的方式出现。
        let mut settings = Settings {
            ui_scale: 1.1,
            ..Settings::default()
        };
        assert_eq!(settings.normalized_ui_scale(), 1.0, "1.1 离 1.0 更近");
        settings.ui_scale = 1.4;
        assert_eq!(settings.normalized_ui_scale(), 1.5, "1.4 离 1.5 更近");
        settings.ui_scale = 0.85;
        assert_eq!(settings.normalized_ui_scale(), 0.85);
    }

    #[test]
    fn a_broken_scale_value_falls_back_to_normal() {
        // 手改配置写进来的 NaN / inf 不该让窗口缩放跟着坏掉。
        let mut settings = Settings {
            ui_scale: f64::NAN,
            ..Settings::default()
        };
        assert_eq!(settings.normalized_ui_scale(), 1.0);
        settings.ui_scale = f64::INFINITY;
        // 到四档的距离全是无穷大，数值比较没有意义——所以显式回默认。
        assert_eq!(settings.normalized_ui_scale(), 1.0);
    }

    #[test]
    fn the_blacklist_matches_case_insensitively_in_both_directions() {
        let settings = Settings {
            selection_blacklist: vec!["1Password".to_string(), "keepass".to_string()],
            ..Settings::default()
        };
        // 应用实际名称的大小写、以及用户填的简称，都要能命中。
        assert!(settings.is_selection_blocked("1password"));
        assert!(settings.is_selection_blocked("1Password"));
        assert!(
            settings.is_selection_blocked("KeePassXC"),
            "简称 keepass 应命中 KeePassXC"
        );
    }

    #[test]
    fn an_empty_blacklist_blocks_nothing() {
        let settings = Settings::default();
        // 默认 seeded 列表之外的常见应用不受影响。
        assert!(!settings.is_selection_blocked("Safari"));
        assert!(!settings.is_selection_blocked("Slack"));
    }

    #[test]
    fn a_blank_app_name_is_never_blocked() {
        // 读不到应用名时宁可放行——拦错一条正常翻译比泄密路径的误报更烦。
        let settings = Settings {
            selection_blacklist: vec!["slack".to_string()],
            ..Settings::default()
        };
        assert!(!settings.is_selection_blocked(""));
        assert!(!settings.is_selection_blocked("   "));
    }

    #[test]
    fn parse_dedupes_ignoring_case_and_keeps_the_first_spelling() {
        let parsed = parse_selection_blacklist("1Password\n\nkeepass\n1PASSWORD\n  bitwarden  ");
        assert_eq!(parsed, vec!["1Password", "keepass", "bitwarden"]);
    }

    #[test]
    fn parse_skips_blank_lines() {
        assert!(parse_selection_blacklist("\n  \n").is_empty());
    }

    #[test]
    fn the_default_list_covers_the_common_password_managers() {
        let defaults = default_selection_blacklist();
        for manager in ["1password", "keepassxc", "bitwarden", "keychain"] {
            assert!(
                defaults.iter().any(|entry| entry.contains(manager)),
                "默认黑名单缺 {manager}"
            );
        }
    }

    #[test]
    fn the_native_language_defaults_to_unspecified() {
        let settings = Settings::default();
        assert_eq!(settings.native_lang, "", "母语默认留空 = 不做假设");
    }
    #[test]
    fn settings_json_never_has_a_credential_field() {
        // BYOK 的安全不变量：**字段名**里不允许出现凭据类命名——
        // 新增字段时如果踩到（比如加了 `api_key`），这条会立刻失败。
        //
        // 检查字段名而不是全文子串：黑名单的**值**里有 "1Password" 这种应用名，
        // 它不是凭据（那是我们拒绝读取的应用）。按值匹配会把合法内容误判成泄密。
        let value = serde_json::to_value(Settings::default()).unwrap();
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
            for forbidden in ["apikey", "api_key", "secret", "token", "password"] {
                assert!(
                    !lower.contains(forbidden),
                    "设置里出现了疑似凭据字段 {key}（含 {forbidden}）"
                );
            }
        }
        // 顶层字段也必须有：防止整个结构意外变成别的形状。
        assert!(keys.len() > 10, "设置字段数量异常：{keys:?}");
    }

    #[test]
    fn a_per_provider_url_overrides_the_builtin_one() {
        let mut settings = Settings::default();
        let openai = umuo_core::provider::find_provider("openai").unwrap();
        assert_eq!(settings.base_url_override(openai).unwrap(), None);

        settings
            .provider_base_urls
            .insert("openai".to_string(), "https://relay.example/v1".to_string());
        assert_eq!(
            settings.base_url_override(openai).unwrap().as_deref(),
            Some("https://relay.example/v1")
        );
    }

    #[test]
    fn azure_without_an_endpoint_is_refused_before_the_request() {
        // 不拦的话请求会打到一个空地址——用户看到的是一条莫名其妙的网络错误。
        let settings = Settings::default();
        let azure = umuo_core::provider::find_provider("azure").unwrap();
        assert!(matches!(
            settings.base_url_override(azure),
            Err(umuo_core::CoreError::AzureEndpointMissing)
        ));
    }

    #[test]
    fn azure_with_an_endpoint_is_used() {
        let mut settings = Settings::default();
        settings.provider_base_urls.insert(
            "azure".to_string(),
            "https://my-resource.openai.azure.com".to_string(),
        );
        let azure = umuo_core::provider::find_provider("azure").unwrap();
        assert_eq!(
            settings.base_url_override(azure).unwrap().as_deref(),
            Some("https://my-resource.openai.azure.com")
        );
    }

    #[test]
    fn the_custom_endpoint_still_works_through_its_own_field() {
        // 回归保护：新的 map 不该让老配置里的自定义端点失效。
        // 用结构体更新语法而不是先 default 再赋值：clippy 的
        // `field_reassign_with_default` 就是冲着这种写法来的。
        let settings = Settings {
            custom_base_url: "https://my-gateway/v1".to_string(),
            ..Settings::default()
        };
        let custom = umuo_core::provider::find_provider("custom").unwrap();
        assert_eq!(
            settings.base_url_override(custom).unwrap().as_deref(),
            Some("https://my-gateway/v1")
        );
    }

    #[test]
    fn blank_entries_do_not_count_as_configured() {
        // 界面在用户点进输入框又清空时会留下空串。
        let mut settings = Settings::default();
        settings
            .provider_base_urls
            .insert("azure".to_string(), "   ".to_string());
        let azure = umuo_core::provider::find_provider("azure").unwrap();
        assert!(settings.base_url_override(azure).is_err());
    }

    #[test]
    fn missing_file_yields_defaults() {
        let dir = temp_dir("missing");
        assert_eq!(Settings::load(&dir), Settings::default());
    }

    #[test]
    fn corrupt_file_falls_back_and_is_backed_up_rather_than_lost() {
        let dir = temp_dir("corrupt");
        fs::write(Settings::path_in(&dir), "{ 这不是 JSON").unwrap();

        let loaded = Settings::load(&dir);
        assert_eq!(loaded, Settings::default(), "坏文件应回落到默认值");
        assert_eq!(
            crate::persist::corrupt_backups(&dir, SETTINGS_FILE).len(),
            1,
            "坏文件应被备份，而不是被覆盖丢掉"
        );
    }

    #[test]
    fn partial_file_keeps_defaults_for_absent_fields() {
        // 老版本写的文件缺字段时，缺的那部分取默认值，而不是整份作废。
        let dir = temp_dir("partial");
        fs::write(
            Settings::path_in(&dir),
            r#"{"providerId":"deepseek","targetLang":"ja"}"#,
        )
        .unwrap();
        let loaded = Settings::load(&dir);
        assert_eq!(loaded.provider_id, "deepseek");
        assert_eq!(loaded.target_lang, "ja");
        assert_eq!(loaded.secondary_target_lang, "en", "缺的字段应取默认值");
    }

    #[test]
    fn a_plain_http_endpoint_is_refused_but_https_and_loopback_are_fine() {
        let previous = Settings::default();
        let with = |id: &str, url: &str| {
            let mut s = Settings::default();
            s.provider_base_urls.insert(id.to_string(), url.to_string());
            s.validate_endpoints(&previous)
        };
        let error = with("openai", "http://evil.example/v1").unwrap_err();
        assert!(error.contains("openai"), "错误要指出是哪个供应商：{error}");
        assert!(with("openai", "https://relay.example/v1").is_ok());
        assert!(with("ollama", "http://localhost:11434").is_ok());
        assert!(with("ollama", "http://127.0.0.1:11434/v1").is_ok());
        assert!(with("ollama", "http://[::1]:11434").is_ok());
        // 本机模型类供应商不发 Key：局域网另一台机器上的 Ollama 走 http 也要能存。
        assert!(with("ollama", "http://192.168.1.10:11434").is_ok());
        assert!(with("ollama", "http://mac-mini.local:11434").is_ok());
        assert!(with("lmstudio", "http://10.0.0.3:1234/v1").is_ok());
        assert!(with("ollama", "ftp://192.168.1.10").is_err());
        assert!(with("openai", "http://192.168.1.10:11434").is_err());
        assert!(with("openai", "   ").is_ok(), "空白 = 没填，不在这里拦");
        assert!(with("openai", "ftp://x").is_err());
        assert!(with("openai", "不是地址").is_err());

        let custom = Settings {
            custom_base_url: "http://192.168.1.5:8080/v1".to_string(),
            ..Settings::default()
        };
        assert!(custom.validate_endpoints(&previous).is_err());
    }

    #[test]
    fn an_endpoint_that_did_not_change_is_not_rechecked() {
        // 老配置里已有的局域网 http 地址：不该让用户从此改不了主题。
        let mut previous = Settings {
            custom_base_url: "http://192.168.1.5:8080/v1".to_string(),
            ..Settings::default()
        };
        previous
            .provider_base_urls
            .insert("openai".to_string(), "http://10.0.0.2/v1".to_string());
        let mut next = previous.clone();
        next.theme = "dark".to_string();
        assert!(next.prepare_for_save(&previous).is_ok());
    }

    #[test]
    fn prepare_for_save_rejects_a_bad_proxy_like_the_settings_page_does() {
        let mut next = Settings {
            proxy_mode: "custom".to_string(),
            proxy_url: String::new(),
            ..Settings::default()
        };
        assert!(next.prepare_for_save(&Settings::default()).is_err());
    }

    #[test]
    fn remembering_an_app_target_only_touches_that_entry() {
        let mut latest = Settings {
            theme: "dark".to_string(),
            ..Settings::default()
        };
        assert!(!latest.remember_app_target("Safari", "   "), "空白语言不记");
        assert!(!latest.remember_app_target("   ", "ja"), "空白应用名不记");
        assert!(latest.remember_app_target(" Safari ", " ja "));
        assert_eq!(latest.theme, "dark", "其它字段保持最新值");
        assert_eq!(
            latest.app_target_langs.get("Safari").map(String::as_str),
            Some("ja")
        );
        assert!(
            !latest.remember_app_target("Safari", "ja"),
            "没变就不用写盘"
        );
    }

    #[test]
    fn prepare_for_save_strips_secret_looking_unknown_fields() {
        let mut next = Settings::default();
        next.extra
            .insert("openaiApiKey".into(), serde_json::json!("sk-secret"));
        next.extra
            .insert("custom_token".into(), serde_json::json!("tok-123"));
        next.extra
            .insert("futurePreference".into(), serde_json::json!(true));
        next.prepare_for_save(&Settings::default()).unwrap();
        assert!(!next.extra.contains_key("openaiApiKey"));
        assert!(!next.extra.contains_key("custom_token"));
        assert_eq!(
            next.extra.get("futurePreference"),
            Some(&serde_json::json!(true))
        );
    }
}
