//! 前端可调用的命令。
//!
//! 约定：**命令里不写业务逻辑**——校验参数、调用内核、返回结果。
//! 尤其是 Key：命令只负责把用户输入的那一串交给 Keychain，
//! 而**回传**给前端的只有「有没有配过」这个布尔值（`key_status`）。
//! 一旦让前端能读回明文 Key，它就会出现在 WebView 的内存与 devtools 里，
//! BYOK 的安全承诺也就名存实亡。

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use umuo_core::provider::{self, ProviderKind};
use umuo_platform::{ScreenCapture, SecretStore, SelectionReader, Speech};

use crate::compare;
use crate::settings::Settings;
use crate::translator;
use crate::{
    AppState, COMPARE_LABEL, COMPOSE_LABEL, HISTORY_LABEL, ONBOARDING_LABEL, PANEL_LABEL,
    QUICK_LABEL, SETTINGS_LABEL,
};

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

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().expect("设置锁不应中毒").clone()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    mut settings: Settings,
) -> Result<Settings, String> {
    // 自建预设先规范化：能修的修（空标签、越界温度），修不了的明确报错。
    // 报错而不是静默丢弃——用户会看到自己刚存的预设凭空消失，那更糟。
    settings.normalize_custom_styles()?;
    settings.normalize_selection_blacklist();
    // 代理地址当场校验：填错了要在设置页立刻说，而不是等下次翻译莫名其妙地失败。
    settings.proxy_choice()?;
    settings
        .save(&state.config_dir)
        .map_err(|e| e.to_string())?;
    let hotkeys_changed = {
        let mut current = state.settings.lock().expect("设置锁不应中毒");
        let changed = current.hotkeys() != settings.hotkeys();
        *current = settings.clone();
        changed
    };
    // 快捷键改了就当场重注册，不用重启客户端。
    if hotkeys_changed {
        crate::reregister_hotkeys(&app, settings.clone());
    }
    // 广播主题：浮窗是常驻窗口，不广播的话用户改完主题要等到下次重启才看到效果，
    // 会以为"设置没生效"。
    let _ = app.emit("settings://theme", settings.theme.clone());
    // 语言同理：浮窗常驻，不广播的话用户改完语言要重启才看到。
    let _ = app.emit("settings://locale", settings.locale.clone());
    let _ = app.emit("settings://scale", settings.ui_scale);
    // 托盘图标样式改动即时生效：重建客户端要重启，托盘图标不用。
    crate::apply_tray_style(&app, &settings);
    // 返回**规范化之后**的设置：前端拿它覆盖本地 state，
    // 否则设置页显示的还是用户填的原始值，与真正生效的规则不一致。
    Ok(settings)
}

#[tauri::command]
pub fn provider_catalog() -> Vec<ProviderDto> {
    provider::PROVIDERS.iter().map(to_dto).collect()
}

fn to_dto(p: &provider::Provider) -> ProviderDto {
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
#[tauri::command]
pub fn configured_providers(state: State<'_, AppState>) -> Vec<ProviderDto> {
    provider::PROVIDERS
        .iter()
        .filter(|p| {
            !p.requires_key()
                || state
                    .secrets
                    .get(p.id)
                    .ok()
                    .flatten()
                    .is_some_and(|key| !key.trim().is_empty())
        })
        .map(to_dto)
        .collect()
}

/// 浮窗的「重译」：同一段原文，换供应商 / 模型 / 风格再翻一次（PRD §5.2）。
///
/// 三个覆盖都只影响**这一次请求**，不写回设置——用户在浮窗上试一下别的模型，
/// 不该把他配置的默认模型悄悄改掉。
#[tauri::command]
pub fn retranslate(
    app: AppHandle,
    text: String,
    provider_id: Option<String>,
    model: Option<String>,
    style_id: Option<String>,
    mode: Option<String>,
) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(EMPTY_TEXT.to_string());
    }
    // 模式由调用方给（OCR 结果窗重译要保住 ocr，原文才继续可编辑），
    // 但只放行两个模式——见 `translator::retranslate_mode`。
    let mode = translator::retranslate_mode(mode.as_deref()).map_err(|e| e.to_string())?;
    translator::spawn(
        &app,
        translator::Request::retranslate(trimmed, mode, provider_id, model, style_id),
        None,
    );
    Ok(())
}

/// 把译文替换回源应用（PRD §5.2「替换原文（若源 App 可写）」）。
///
/// 守卫用**显示浮窗时记下的那个应用**：与静默翻译同一套保护——
/// 用户切走了就不写回，避免把译文打进别的应用。写不进去时返回原因，
/// 由浮窗显示，而不是静默失败。
#[tauri::command]
pub fn replace_source(app: AppHandle, text: String) -> Result<(), String> {
    let guard = {
        let state = app.state::<AppState>();
        // 具名绑定：直接把 `lock().clone()` 写成尾表达式的话，
        // MutexGuard 这个临时值会在块尾与 `state` 一起析构，借用检查过不去。
        let owner = state.panel_owner.lock().expect("浮窗归属锁不应中毒");
        owner.clone()
    };
    translator::write_back(&app, guard.as_deref(), &text).map_err(|e| e.to_string())
}

/// 把当前原文（可带译文）带到撰写窗（PRD §5.2「在撰写窗中打开」）。
#[tauri::command]
pub fn open_compose_with(
    app: AppHandle,
    text: String,
    translation: Option<String>,
) -> Result<(), String> {
    crate::show_compose(&app);
    let _ = app.emit_to(
        COMPOSE_LABEL,
        "compose://prefill",
        PrefillPayload { text, translation },
    );
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefillPayload {
    pub text: String,
    pub translation: Option<String>,
}

/// 只回「配没配过」，不回明文——见文件头部的说明。
#[tauri::command]
pub fn key_status(state: State<'_, AppState>, provider_id: String) -> Result<bool, String> {
    let secret = state.secrets.get(&provider_id).map_err(|e| e.to_string())?;
    Ok(secret.is_some_and(|s| !s.trim().is_empty()))
}

#[tauri::command]
pub fn save_api_key(
    state: State<'_, AppState>,
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    // 供应商 id 必须先校验存在：否则一个拼错的 id 会在 Keychain 里留下一条永远读不到的记录。
    if provider::find_provider(&provider_id).is_none() {
        return Err(format!("未知供应商：{provider_id}"));
    }
    state
        .secrets
        .set(&provider_id, api_key.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_api_key(state: State<'_, AppState>, provider_id: String) -> Result<(), String> {
    state
        .secrets
        .delete(&provider_id)
        .map_err(|e| e.to_string())
}

/// 用用户自己的 Key 拉一次模型列表，同时也就校验了 Key 是否有效（PRD §6.2 第 3 步）。
#[tauri::command]
pub async fn list_models(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<Vec<String>, String> {
    let provider = provider::find_provider(&provider_id).ok_or_else(|| "未知供应商".to_string())?;
    let api_key = state
        .secrets
        .get(provider.id)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let settings = state.settings.lock().expect("设置锁不应中毒").clone();
    let base_url = settings
        .base_url_override(provider)
        .map_err(|e| e.to_string())?;
    let wire = match base_url.as_deref() {
        Some(url) => umuo_core::wire::build_models_request_at(provider, url, &api_key),
        None => umuo_core::wire::build_models_request(provider, &api_key),
    }
    .map_err(|e| e.to_string())?;
    let body = umuo_core::transport::fetch_json(&state.client, &wire, Duration::from_secs(15))
        .await
        .map_err(|e| e.to_string())?;
    umuo_core::wire::parse_models_list(provider.protocol, &body).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn accessibility_trusted(app: AppHandle, state: State<'_, AppState>) -> bool {
    let trusted = state.selection.is_trusted();
    if trusted {
        // 刚授完权：之前因缺权限没起来的连按快捷键（新装默认的 ⌃⌃）现在补上
        crate::double_tap::retry_start(&app);
    }
    trusted
}

/// 翻译风格目录（内置 + 用户自建）。前端不该自己维护一份风格清单——那样两边一定会漂移。
#[tauri::command]
pub fn style_catalog(state: State<'_, AppState>) -> Vec<StyleDto> {
    let settings = state.settings.lock().expect("设置锁不应中毒");
    umuo_core::prompt::all_styles(&settings.custom_styles)
        .into_iter()
        .map(|s| StyleDto {
            id: s.id,
            label: s.label,
            custom: s.custom,
        })
        .collect()
}

/// 打开「隐私与安全性 → 辅助功能」面板。
///
/// 用专用的命令而不是复用 `open_external`：那个命令只放行 https，
/// 而这里要开的是系统设置的私有 scheme，只有我们写死的这个 URL 是安全的。
#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn copy_text(text: String) -> Result<(), String> {
    use umuo_platform::Clipboard;
    umuo_platform_macos::MacClipboard
        .write_text(&text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn translate_text(app: AppHandle, text: String) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("没有可翻译的文本".to_string());
    }
    crate::translator::trigger_with_text(&app, text);
    Ok(())
}

#[tauri::command]
pub fn cancel_translation(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn hide_panel(app: AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.hide();
    }
}

#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        SETTINGS_LABEL,
        WebviewUrl::App("settings.html".into()),
    )
    .title("umuo 设置")
    // 左侧分区栏 + 右侧分组行：内容区约 580pt 宽时，英文与日文的行说明也不会把右侧控件挤到折行
    .inner_size(840.0, 700.0)
    .min_inner_size(720.0, 520.0)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 打开首次启动引导（PRD §7.4）。
#[tauri::command]
pub fn open_onboarding(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(ONBOARDING_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        ONBOARDING_LABEL,
        WebviewUrl::App("onboarding.html".into()),
    )
    .title("欢迎使用 umuo")
    .inner_size(720.0, 560.0)
    .min_inner_size(560.0, 460.0)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 引导走完了：记下来并关掉窗口。
///
/// **无论用户有没有配好引擎都记录**——他可能就是想先看看客户端长什么样。
/// 界面负责在这种情况下说清后果，而不是靠不让他关窗口来「保证」什么。
#[tauri::command]
pub fn finish_onboarding(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.lock().expect("设置锁不应中毒");
        settings.onboarding_done = true;
        settings
            .save(&state.config_dir)
            .map_err(|e| e.to_string())?;
    }
    // 关掉而不是隐藏：引导只在首次需要，之后用「重新运行首次引导」再打开。
    if let Some(window) = app.get_webview_window(ONBOARDING_LABEL) {
        let _ = window.close();
    }
    Ok(())
}

/// 关于页的反馈邮箱；与前端 `settings/AboutPage.tsx` 的 FEEDBACK_URL 保持一致。
const FEEDBACK_MAILTO: &str = "mailto:hello@umuo.app";

/// 在系统浏览器里打开链接（申请 Key 的官方页面等）。
///
/// 只允许 https，外加关于页「发送反馈」的那一个固定邮箱（`FEEDBACK_MAILTO`）：
/// 这个命令会被前端以任意字符串调用，放开 `file://` 或任意 scheme 等于把「打开本机文件」的能力交给页面。
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    // 只放行 https，外加关于页「发送反馈」用的那一个固定邮箱——不开放任意 mailto/scheme。
    if !url.starts_with("https://") && url != FEEDBACK_MAILTO {
        return Err("只允许打开 https 链接".to_string());
    }
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------- 撰写窗（PRD §5.3）

const EMPTY_TEXT: &str = "没有可翻译的内容";

/// 快捷面板的尺寸与位置参数（PRD §7.1）。
const QUICK_WIDTH: f64 = 340.0;
const QUICK_HEIGHT: f64 = 420.0;
/// 拿不到托盘图标位置时，面板离屏幕顶部的距离——菜单栏大约就这么高。
const MENUBAR_FALLBACK_Y: f64 = 30.0;
/// 面板右缘相对托盘图标中心的内缩（逻辑点）。
const TRAY_ANCHOR_INSET: f64 = 40.0;
/// 面板里最多显示几条最近翻译。
const QUICK_RECENT_LIMIT: u32 = 5;
/// 面板里每条最多这么多字符：面板只有 340 宽，一整段选文会把最近翻译挤成一条。
const PANEL_TEXT_LIMIT: usize = 60;

/// ⌥A 与托盘菜单走 [`crate::toggle_compose`]；这个命令给前端与将来的按钮用。
#[tauri::command]
pub fn toggle_compose(app: AppHandle) {
    crate::toggle_compose(&app);
}

#[tauri::command]
pub fn hide_compose(app: AppHandle) {
    if let Some(window) = app.get_webview_window(COMPOSE_LABEL) {
        let _ = window.hide();
    }
}

/// 撰写窗的实时翻译。文本来自输入框，不需要任何系统权限。
#[tauri::command]
pub fn compose_translate(
    app: AppHandle,
    text: String,
    source_lang: Option<String>,
    target_lang: Option<String>,
    provider_id: Option<String>,
    model: Option<String>,
    style_id: Option<String>,
) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(EMPTY_TEXT.to_string());
    }
    // 这些覆盖只作用于**这一次**请求：用户在撰写窗里试一下别的风格，
    // 不该改掉设置里的默认风格。
    translator::spawn(
        &app,
        translator::Request::with_overrides(
            trimmed,
            translator::Mode::Compose,
            translator::Overrides {
                source_lang,
                target_lang,
                provider_id,
                model,
                style_id,
            },
        ),
        None,
    );
    Ok(())
}

/// 回译：把译文翻回**原文的语言**，让用户自检（PRD §5.3）。
///
/// 目标语言由 Rust 侧从原文推断，而不是前端传一个语言码过来——
/// 否则「原文是什么语言」这个判断会在两端各写一遍，迟早不一致。
#[tauri::command]
pub fn compose_back_translate(
    app: AppHandle,
    source_text: String,
    translated_text: String,
) -> Result<(), String> {
    let translated = translated_text.trim();
    if translated.is_empty() {
        return Err(EMPTY_TEXT.to_string());
    }

    let target = umuo_core::lang::detect(&source_text);
    match target {
        Some(language) => {
            translator::spawn(
                &app,
                translator::Request::back_translate(translated, language),
                None,
            );
            Ok(())
        }
        // 原文语言判断不出来时不硬猜：猜错的语言会让回译结果毫无参考价值。
        None => Err("无法判断原文语言，回译不可用".to_string()),
    }
}

/// 撰写窗的提交动作（PRD §5.3）。
///
/// `paste` 为 true 时对应 ⌘⇧Enter：写剪贴板 → 收起撰写窗 → 让焦点回到上一个 App
/// 后再粘贴。中间那段等待是必需的：窗口刚收起时前台应用还没切回去，
/// 立刻发 ⌘V 会打给一个错误的接收者。
#[tauri::command]
pub async fn compose_commit(app: AppHandle, text: String, paste: bool) -> Result<(), String> {
    use umuo_platform::Clipboard;

    if text.trim().is_empty() {
        return Err(EMPTY_TEXT.to_string());
    }

    let clipboard = umuo_platform_macos::MacClipboard;
    clipboard.write_text(&text).map_err(|e| e.to_string())?;

    // 两种提交都收起撰写窗：PRD §5.3 的 ⌘Enter 与 ⌘⇧Enter 都是「复制并关闭」。
    if let Some(window) = app.get_webview_window(COMPOSE_LABEL) {
        let _ = window.hide();
    }

    if !paste {
        return Ok(());
    }

    let state = app.state::<AppState>();
    let selection = &state.selection;
    // 等焦点回到上一个 App。这个延时不是「保险起见」，而是这一步的必要组成：
    // 抢在窗口切换完成之前按键，粘贴会落空或落到我们的窗口上。
    tokio::time::sleep(std::time::Duration::from_millis(220)).await;
    selection.paste_clipboard().map_err(|e| e.to_string())
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

fn picks_from(state: &AppState) -> Vec<PickDto> {
    state
        .stats
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

/// 从命令发起一次对比（浮窗里的「对比」按钮、将来的右键菜单）。
#[tauri::command]
pub fn compare_translate(app: AppHandle, text: String) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(EMPTY_TEXT.to_string());
    }
    compare::spawn(&app, trimmed.to_string());
    Ok(())
}

#[tauri::command]
pub fn hide_compare(app: AppHandle) {
    if let Some(window) = app.get_webview_window(COMPARE_LABEL) {
        let _ = window.hide();
    }
}

/// 记一次「选它」。返回更新后的完整排行，前端不必再发一次查询。
#[tauri::command]
pub fn record_compare_pick(
    state: State<'_, AppState>,
    provider_id: String,
    model: String,
) -> Result<Vec<PickDto>, String> {
    if provider::find_provider(&provider_id).is_none() {
        return Err(format!("未知供应商：{provider_id}"));
    }

    {
        let mut stats = state.stats.lock().expect("统计锁不应中毒");
        stats.record_pick(&provider_id, &model);
        // 写盘失败不让命令失败：这一次标记仍然生效于内存，只是重启后可能丢。
        // 反过来（报错并回滚）会让用户以为没记上，实际却是记上了。
        if let Err(error) = stats.save(&state.config_dir) {
            eprintln!("umuo: 对比偏好写盘失败：{error}");
        }
    }

    Ok(picks_from(&state))
}

#[tauri::command]
pub fn compare_picks(state: State<'_, AppState>) -> Vec<PickDto> {
    picks_from(&state)
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
#[tauri::command]
pub fn history_query(
    app: AppHandle,
    filter: Option<HistoryFilterDto>,
    limit: u32,
    offset: u32,
) -> Result<Vec<RecordDto>, String> {
    let filter = filter.unwrap_or_default();
    let rows = crate::history::with_store(&app, |store| {
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
#[tauri::command]
pub fn history_facets(app: AppHandle) -> Result<umuo_store::Facets, String> {
    crate::history::with_store(&app, |store| store.facets())
}

#[tauri::command]
pub fn history_delete(app: AppHandle, id: i64) -> Result<bool, String> {
    crate::history::with_store(&app, |store| store.delete(id))
}

#[tauri::command]
pub fn history_clear(app: AppHandle) -> Result<usize, String> {
    crate::history::with_store(&app, |store| store.clear())
}

/// 本月的次数、token 与费用（PRD §5.10）。
#[tauri::command]
pub fn usage_summary(app: AppHandle) -> Result<UsageDto, String> {
    let summary = crate::history::month_usage(&app)?;
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDto {
    pub count: u32,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub unpriced: u32,
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
fn records_to_dto(rows: Vec<umuo_store::Record>) -> Vec<RecordDto> {
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

#[tauri::command]
pub fn open_history(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(HISTORY_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, HISTORY_LABEL, WebviewUrl::App("history.html".into()))
        .title("umuo 翻译历史")
        .inner_size(760.0, 620.0)
        .min_inner_size(560.0, 420.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 最近 `days` 天的按日用量（PRD §5.10）。
#[tauri::command]
pub fn usage_daily(app: AppHandle, days: u32) -> Result<Vec<umuo_store::DayUsage>, String> {
    // 上限给到一年：再长的窗口在界面上也读不完，而且会让查询与渲染都变慢。
    let days = days.clamp(1, 365);
    let since = crate::history::now_unix() - i64::from(days) * 86_400;
    crate::history::with_store(&app, |store| store.usage_by_day(since))
}

// ---------------------------------------------------------------- 菜单栏快捷面板（PRD §7.1）

/// 打开（或收起）快捷面板。
///
/// 从托盘左键调用时会给一个位置（托盘图标附近），从菜单调用时没有位置，
/// 那时放到屏幕右上角——菜单栏应用的面板就该从那个方向出来。
pub fn open_quick_panel(app: &AppHandle, near: Option<tauri::PhysicalPosition<f64>>) {
    let window = match app.get_webview_window(QUICK_LABEL) {
        Some(window) => {
            // 已经开着就收起：同一个入口既开又关，比"再点一次没反应"好。
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
                return;
            }
            window
        }
        None => {
            // 失败要说出来：静默 return 会让「点了没反应」变成没法查的问题。
            let built =
                WebviewWindowBuilder::new(app, QUICK_LABEL, WebviewUrl::App("quick.html".into()))
                    .title("umuo")
                    .inner_size(QUICK_WIDTH, QUICK_HEIGHT)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .resizable(false)
                    .shadow(true)
                    .visible(false)
                    .build();
            match built {
                Ok(window) => window,
                Err(error) => {
                    eprintln!("umuo: 快捷面板窗口创建失败：{error}");
                    return;
                }
            }
        }
    };

    // 面板要**能输入**，所以它抢焦点（与翻译浮窗相反）。
    let _ = window.show();
    let _ = window.set_focus();
    // **单位要统一**：托盘事件给的位置、屏幕尺寸都是**物理像素**，
    // 而 QUICK_WIDTH 是人类可读的逻辑点。Retina 上混用会让面板露出一半在屏幕外
    // —— 实测就是这么发现的：x 算出 2100，而屏幕只有 2364 物理像素宽。
    let scale = window.scale_factor().unwrap_or(2.0);
    let width_px = QUICK_WIDTH * scale;
    let screen_width = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| f64::from(monitor.size().width));

    if let Some(position) = near {
        // 面板右缘大致对齐托盘图标：菜单栏应用的面板就该从图标下面展开。
        let mut x = position.x - width_px + TRAY_ANCHOR_INSET * scale;
        if let Some(width) = screen_width {
            x = x.min(width - width_px - 8.0);
        }
        let x = x.max(8.0);
        let _ = window.set_position(tauri::PhysicalPosition::new(x, position.y + 6.0));
    } else if let Some(width) = screen_width {
        let _ = window.set_position(tauri::PhysicalPosition::new(
            width - width_px - 8.0,
            MENUBAR_FALLBACK_Y,
        ));
    }
}

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

#[tauri::command]
pub fn quick_state(app: AppHandle, state: State<'_, AppState>) -> Result<QuickState, String> {
    let settings = state.settings.lock().expect("设置锁不应中毒").clone();
    let paused = state.paused.load(Ordering::Relaxed);
    let provider_label = provider::find_provider(&settings.provider_id)
        .map(|p| p.label.to_string())
        .unwrap_or_else(|| settings.provider_id.clone());

    // 最近几条：拿不到就空列表，不该让整个面板打不开。
    let recent = crate::history::with_store(&app, |store| {
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

    Ok(QuickState {
        paused,
        provider_label,
        model: settings.model,
        recent,
    })
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

/// 暂停 / 恢复。返回切换后的状态。
#[tauri::command]
pub fn set_paused(state: State<'_, AppState>, paused: bool) -> bool {
    state.paused.store(paused, Ordering::Relaxed);
    paused
}

/// 快捷面板里点了「翻译」：走与 ⌥D 完全相同的流水线，并收起面板。
#[tauri::command]
pub fn quick_translate(app: AppHandle, text: String) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(EMPTY_TEXT.to_string());
    }
    if let Some(window) = app.get_webview_window(QUICK_LABEL) {
        let _ = window.hide();
    }
    crate::translator::trigger_with_text(&app, trimmed.to_string());
    Ok(())
}

// ---------------------------------------------------------------- 快捷键状态（PRD §7.2）

/// 注册时被系统拒绝的快捷键（按功能名）。
///
/// 静态冲突检查（录制时）只能拦"明显不对"的组合；真正"被别的应用占着"
/// 这件事只有注册一次才知道——所以这个结果要能回到界面上。
#[tauri::command]
pub fn hotkey_failures(state: State<'_, AppState>) -> Vec<String> {
    state
        .hotkey_failures
        .lock()
        .expect("快捷键失败锁不应中毒")
        .clone()
}

/// 录快捷键最长持续多久。超过就当作被放弃，自动恢复全局快捷键。
const HOTKEY_RECORDING_LIMIT: std::time::Duration = std::time::Duration::from_secs(30);

/// 设置窗开始 / 结束「录快捷键」。
///
/// 开始时**注销全部全局快捷键**：macOS 会把已注册的组合键直接截走，网页收不到——
/// 不注销的话，想重录当前这个键（或任何已占用的键）时录键器什么也收不到。
/// 结束时按当前设置重新注册。录到一半窗口被关掉、前端来不及说「结束」，
/// 由一个定时器在截止时间后自动恢复，快捷键不会永久失灵。
#[tauri::command]
pub fn set_hotkey_recording(app: AppHandle, state: State<'_, AppState>, active: bool) {
    let was_recording = {
        let mut until = state.recording_until.lock().expect("录键锁不应中毒");
        let was = until.is_some();
        *until = active.then(|| std::time::Instant::now() + HOTKEY_RECORDING_LIMIT);
        was
    };
    if active {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = handle.global_shortcut().unregister_all() {
                // 注销失败时，已占用的组合仍会被系统截走、录键器收不到——至少留下记录便于排查。
                eprintln!("umuo: 录快捷键前注销全局快捷键失败：{error}");
            }
        });
        let watchdog = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(HOTKEY_RECORDING_LIMIT + std::time::Duration::from_millis(200));
            let Some(state) = watchdog.try_state::<AppState>() else {
                return;
            };
            let expired = {
                let mut until = state.recording_until.lock().expect("录键锁不应中毒");
                let expired = until.is_some_and(|deadline| std::time::Instant::now() >= deadline);
                if expired {
                    *until = None;
                }
                expired
            };
            if expired {
                let settings = state.settings.lock().expect("设置锁不应中毒").clone();
                crate::reregister_hotkeys(&watchdog, settings);
            }
        });
    } else if was_recording {
        let settings = state.settings.lock().expect("设置锁不应中毒").clone();
        crate::reregister_hotkeys(&app, settings);
    }
}

// ---------------------------------------------------------------- 开机启动（PRD §7.3 通用）

/// 客户端版本号（关于页用）。取自编译期写入的包版本——
/// 前端自己写死会在某次发版后悄悄说谎。
#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 现在是不是开机自启。判据是 LaunchAgent 文件在不在。
#[tauri::command]
pub fn autostart_status() -> Result<bool, String> {
    Ok(crate::autostart::is_enabled(&home_dir()?))
}

/// 打开 / 关闭开机自启，返回**实际生效**的状态。
///
/// 返回状态而不是 `()`：写文件可能失败（权限、路径），
/// 让界面拿到真实结果，比让它乐观地显示"已开启"要诚实。
#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    let home = home_dir()?;
    let exec = std::env::current_exe().map_err(|e| format!("读不到程序路径：{e}"))?;
    crate::autostart::set_enabled(&home, &exec, enabled).map_err(|e| format!("写入失败：{e}"))?;
    Ok(crate::autostart::is_enabled(&home))
}

fn home_dir() -> Result<std::path::PathBuf, String> {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "读不到 HOME".to_string())
}

// ---------------------------------------------------------------- 配置导入导出（PRD §6.4）

/// 导出配置与术语表到固定位置，返回写出的完整路径。
///
/// 导出内容**不含 API Key**（Key 只在 Keychain，设置与术语表里都没有它）。
#[tauri::command]
pub fn export_config(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().expect("设置锁不应中毒").clone();
    let glossaries = state.glossaries.lock().expect("术语表锁不应中毒").clone();

    let bundle = crate::config_io::Bundle {
        version: crate::config_io::BUNDLE_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        settings,
        glossaries,
    };

    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "读不到 HOME，无法确定导出位置".to_string())?;
    let path = crate::config_io::export_path_in(&home);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }

    let json = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("写入失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// 从文件导入配置与术语表，返回"应用了什么"的摘要。
///
/// **不碰 Keychain**：导入的包里没有 Key，用户的 Key 保持原样。
/// 新机器上导完之后仍需自己填 Key——界面要把这句话说清楚。
#[tauri::command]
pub fn import_config(
    state: State<'_, AppState>,
    path: String,
) -> Result<crate::config_io::ImportSummary, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取失败：{e}"))?;
    let bundle: crate::config_io::Bundle =
        serde_json::from_str(&raw).map_err(|e| format!("不是有效的 umuo 配置文件：{e}"))?;
    crate::config_io::check_version(bundle.version)?;

    let summary = crate::config_io::ImportSummary {
        provider_id: bundle.settings.provider_id.clone(),
        target_lang: bundle.settings.target_lang.clone(),
        custom_style_count: bundle.settings.custom_styles.len(),
        glossary_count: bundle.glossaries.lists.len(),
        bundle_version: bundle.version,
    };

    {
        let mut settings = state.settings.lock().expect("设置锁不应中毒");
        *settings = bundle.settings;
        settings
            .save(&state.config_dir)
            .map_err(|e| e.to_string())?;
    }
    {
        let mut glossaries = state.glossaries.lock().expect("术语表锁不应中毒");
        *glossaries = bundle.glossaries;
        glossaries
            .save(&state.config_dir)
            .map_err(|e| e.to_string())?;
    }
    Ok(summary)
}

// ---------------------------------------------------------------- 浮窗钉住（PRD §7.1）

/// 浮窗是否被钉住。钉住时用户切到别的应用也不自动收起。
#[tauri::command]
pub fn panel_pinned(state: State<'_, AppState>) -> bool {
    state
        .panel_pinned
        .load(std::sync::atomic::Ordering::Relaxed)
}

/// 切换钉住状态，返回切换后的值。
///
/// 返回新状态而不是 `()`：按钮需要知道最终是亮的还是灭的——
/// 让前端做乐观更新再与服务端对账，是这类小交互里最容易出不一致的写法。
#[tauri::command]
pub fn panel_set_pinned(state: State<'_, AppState>, pinned: bool) -> bool {
    state
        .panel_pinned
        .store(pinned, std::sync::atomic::Ordering::Relaxed);
    pinned
}

// ---------------------------------------------------------------- 术语表（PRD §5.8）

/// 全部术语表。前端拿它渲染管理界面，**不参与翻译**（翻译用的是下面的命中块）。
#[tauri::command]
pub fn glossary_list(state: State<'_, AppState>) -> Vec<umuo_core::glossary::Glossary> {
    state
        .glossaries
        .lock()
        .expect("术语表锁不应中毒")
        .lists
        .clone()
}

/// 保存（新建或覆盖）一张术语表。
#[tauri::command]
pub fn glossary_save(
    state: State<'_, AppState>,
    glossary: umuo_core::glossary::Glossary,
) -> Result<Vec<umuo_core::glossary::Glossary>, String> {
    let mut store = state.glossaries.lock().expect("术语表锁不应中毒");
    store.upsert(glossary);
    store.save(&state.config_dir).map_err(|e| e.to_string())?;
    Ok(store.lists.clone())
}

#[tauri::command]
pub fn glossary_remove(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<umuo_core::glossary::Glossary>, String> {
    let mut store = state.glossaries.lock().expect("术语表锁不应中毒");
    store.remove(&id);
    store.save(&state.config_dir).map_err(|e| e.to_string())?;
    Ok(store.lists.clone())
}

/// 从 CSV / TSV 文本导入，**替换**该表的全部条目。返回导入条数。
#[tauri::command]
pub fn glossary_import(
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<usize, String> {
    let mut store = state.glossaries.lock().expect("术语表锁不应中毒");
    let count = store.import_into(&id, &text)?;
    store.save(&state.config_dir).map_err(|e| e.to_string())?;
    Ok(count)
}

/// 导出为 CSV 文本。
#[tauri::command]
pub fn glossary_export(state: State<'_, AppState>, id: String) -> Result<String, String> {
    state
        .glossaries
        .lock()
        .expect("术语表锁不应中毒")
        .export(&id)
}

// ---------------------------------------------------------------- 月度上限（PRD §5.10）

/// 本月各供应商的花费，供设置页显示「已用 x / 上限 y」。
#[tauri::command]
pub fn monthly_spend(app: AppHandle) -> Result<Vec<umuo_store::ProviderUsage>, String> {
    crate::history::with_store(&app, |store| {
        let since = store.month_start_unix()?;
        store.usage_by_provider(since)
    })
}

// ---------------------------------------------------------------- 发音朗读（PRD §5.1）

/// 朗读一段文本。
///
/// 语言由 Rust 侧从文本推断（`lang::detect`），**不让前端传**：
/// 「这段是什么语言」的判断只该有一处实现，否则同一个词在浮窗与撰写窗
/// 可能被用不同的发音人念出来。
#[tauri::command]
pub fn speak_text(state: State<'_, AppState>, text: String) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(EMPTY_TEXT.to_string());
    }
    let language = umuo_core::lang::detect(trimmed);
    state
        .speech
        .speak(trimmed, language)
        .map_err(|e| e.to_string())
}

/// 停掉当前朗读。没有在朗读时也返回成功——「停」本来就该是幂等的。
#[tauri::command]
pub fn stop_speaking(state: State<'_, AppState>) -> Result<(), String> {
    state.speech.stop().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- 截图 OCR 权限（PRD §5.5）

/// 当前是否已获得「屏幕录制」权限。**只查询，不弹窗**。
#[tauri::command]
pub fn ocr_permission(state: State<'_, AppState>) -> bool {
    state.capture.permission() == umuo_platform::CapturePermission::Granted
}

/// 主动请求屏幕录制权限（会弹系统对话框）。
///
/// 只在用户明确点了「授权」时才调用：这个对话框一个进程只弹一次，
/// 用户拒绝之后再调也不会再弹，滥用只会把这一次机会浪费掉。
#[tauri::command]
pub fn ocr_request_permission(state: State<'_, AppState>) -> bool {
    state.capture.request_permission() == umuo_platform::CapturePermission::Granted
}

/// 打开「隐私与安全性 → 屏幕录制」。
///
/// 与辅助功能是两个不同的面板，不能混用——把用户送去错误的面板，
/// 他照做之后功能仍然不可用。
#[tauri::command]
pub fn open_screen_recording_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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
fn favorite_kind_for(text: &str) -> umuo_store::FavoriteKind {
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
#[tauri::command]
pub fn favorite_toggle(
    app: AppHandle,
    text: String,
    translation: Option<String>,
) -> Result<bool, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err(EMPTY_TEXT.to_string());
    }
    let kind = favorite_kind_for(&trimmed);

    crate::history::with_store(&app, |store| {
        if store.is_favorited(kind, &trimmed)? {
            store.remove_favorite_by_text(kind, &trimmed)?;
            Ok(false)
        } else {
            store.add_favorite(&umuo_store::NewFavorite {
                created_at: crate::history::now_unix(),
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
#[tauri::command]
pub fn favorites_status(app: AppHandle, texts: Vec<String>) -> Result<Vec<bool>, String> {
    crate::history::with_store(&app, |store| {
        texts
            .iter()
            .map(|text| {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return Ok(false);
                }
                store.is_favorited(favorite_kind_for(trimmed), trimmed)
            })
            .collect::<Result<Vec<bool>, umuo_store::StoreError>>()
    })
}

#[tauri::command]
pub fn favorites_list(app: AppHandle, limit: u32, offset: u32) -> Result<Vec<FavoriteDto>, String> {
    let rows = crate::history::with_store(&app, |store| {
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

#[tauri::command]
pub fn favorite_remove(app: AppHandle, id: i64) -> Result<bool, String> {
    crate::history::with_store(&app, |store| store.remove_favorite(id))
}

#[cfg(test)]
mod quick_panel_tests {
    use super::trim_display;

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
