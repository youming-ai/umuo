//! 前端可调用的命令。
//!
//! 约定：**命令里不写业务逻辑**——校验参数、调用内核、返回结果。
//! 尤其是 Key：命令只负责把用户输入的那一串交给 Keychain，
//! 而**回传**给前端的只有「有没有配过」这个布尔值（`key_status`）。
//! 一旦让前端能读回明文 Key，它就会出现在 WebView 的内存与 devtools 里，
//! BYOK 的安全承诺也就名存实亡。

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use umuo_app::ops::{
    self, FavoriteDto, HistoryFilterDto, PickDto, ProviderDto, QuickState, RecordDto, StyleDto,
    UsageDto,
};
use umuo_app::settings_patch::SettingsEffects;
use umuo_core::provider;
use umuo_platform::{ScreenCapture, SecretStore, SelectionReader, Speech};

use crate::compare;
use crate::settings::Settings;
use crate::translator;
use crate::{
    AppState, COMPARE_LABEL, COMPOSE_LABEL, HISTORY_LABEL, ONBOARDING_LABEL, PANEL_LABEL,
    QUICK_LABEL, SETTINGS_LABEL,
};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().expect("设置锁不应中毒").clone()
}

/// 前端传来的是整份设置：整份作为 patch 交给应用层（不做 diff），校验与落盘都在那里。
#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    let patch = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    let (settings, effects) = state.apply_settings_patch(patch)?;
    run_settings_effects(&app, &settings, effects);
    // 返回**规范化之后**的设置：前端拿它覆盖本地 state，
    // 否则设置页显示的还是用户填的原始值，与真正生效的规则不一致。
    Ok(settings)
}

/// 让一份刚存好的设置**当场生效**。`save_settings` 与 `import_config` 共用：
/// 导入的配置走的是同一套快捷键重注册和广播。
fn run_settings_effects(app: &AppHandle, settings: &Settings, effects: SettingsEffects) {
    // 快捷键改了就当场重注册，不用重启客户端。
    if effects.hotkeys {
        crate::reregister_hotkeys(app, settings.clone());
    }
    // 广播主题：浮窗是常驻窗口，不广播的话用户改完主题要等到下次重启才看到效果，
    // 会以为"设置没生效"。
    let _ = app.emit("settings://theme", settings.theme.clone());
    // 语言同理：浮窗常驻，不广播的话用户改完语言要重启才看到。
    let _ = app.emit("settings://locale", settings.locale.clone());
    let _ = app.emit("settings://scale", settings.ui_scale);
    // 托盘图标样式改动即时生效：重建客户端要重启，托盘图标不用。
    crate::apply_tray_style(app, settings);
}

#[tauri::command]
pub fn provider_catalog() -> Vec<ProviderDto> {
    ops::provider_catalog()
}

/// 浮窗的「换个模型」下拉：只列这次真能用的供应商，规则见 [`ops::configured_providers`]。
#[tauri::command]
pub fn configured_providers(state: State<'_, AppState>) -> Vec<ProviderDto> {
    ops::configured_providers(&state)
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
///
/// 点这个按钮本身就会激活本应用（浮窗不是真·非激活 NSPanel），前台变成自己，
/// 守卫必然拒绝（审查 H5）。所以这时先把源应用切回前台，等焦点回来再写。
#[tauri::command]
pub async fn replace_source(app: AppHandle, text: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let guard = {
        // 具名绑定：直接把 `lock().clone()` 写成尾表达式的话，
        // MutexGuard 这个临时值会在块尾与 `state` 一起析构，借用检查过不去。
        let owner = state.panel_owner.lock().expect("浮窗归属锁不应中毒");
        owner.clone()
    };
    let current = state.selection.frontmost_app_token();
    let own = translator::own_app_token();
    match translator::plan_replace(guard.as_deref(), current.as_deref(), &own) {
        translator::ReplacePlan::NoSource => {
            return Err("这段文字不是从别的应用里取的，没有可替换的原文".to_string());
        }
        translator::ReplacePlan::Refocus => {
            if let Some(owner) = guard.as_deref() {
                refocus_source_app(&state.selection, owner).await;
            }
        }
        translator::ReplacePlan::Write => {}
    }
    // 焦点没回来时这里的守卫会如实拒绝（目标已改变），不会写到别处。
    translator::write_back(&app, guard.as_deref(), &text).map_err(|e| e.to_string())
}

/// 把源应用切回前台，并等到前台确实是它（最多约 600ms）。
///
/// 切换是异步的：请求发出后立刻写，写回会落到我们自己的窗口上。
/// 焦点回来后再多等一拍，让源应用把输入框的焦点与选区恢复好。
async fn refocus_source_app(selection: &impl SelectionReader, owner: &str) {
    if !selection.activate_app(owner) {
        return;
    }
    for _ in 0..24 {
        tokio::time::sleep(Duration::from_millis(25)).await;
        if selection.frontmost_app_token().as_deref() == Some(owner) {
            tokio::time::sleep(Duration::from_millis(50)).await;
            return;
        }
    }
}

/// 把当前原文（可带译文）带到撰写窗（PRD §5.2「在撰写窗中打开」）。
#[tauri::command]
pub fn open_compose_with(
    app: AppHandle,
    window: tauri::WebviewWindow,
    text: String,
    translation: Option<String>,
) -> Result<(), String> {
    // 先算粘贴目标再显示：显示并聚焦撰写窗后前台就成了 umuo 自己。
    // 每次都按调用方重新算，不保留旧值——撰写窗一直开着时旧值可能指向很早以前唤出它的应用，
    // ⌘⇧Enter 会把这段原文的译文粘进那里。规则见 `compose_owner_for_caller`。
    if let Some(state) = app.try_state::<AppState>() {
        // 先单独取浮窗归属，避免同时持有两把锁。
        let panel_owner = state
            .panel_owner
            .lock()
            .expect("浮窗归属锁不应中毒")
            .clone();
        let owner = crate::compose_owner_for_caller(
            state.selection.frontmost_app_token(),
            window.label(),
            panel_owner,
            std::process::id(),
        );
        *state.compose_owner.lock().expect("撰写窗目标锁不应中毒") = owner;
    }
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
    ops::key_status(&state, &provider_id)
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
    ops::list_models(&state, &provider_id).await
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

/// 翻译风格目录（内置 + 用户自建）。
#[tauri::command]
pub fn style_catalog(state: State<'_, AppState>) -> Vec<StyleDto> {
    ops::style_catalog(&state)
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

/// 取消**发起这条命令的那个窗口**当前的请求：对比窗按 Esc 不该停掉浮窗的翻译。
#[tauri::command]
pub fn cancel_translation(window: tauri::WebviewWindow, state: State<'_, AppState>) {
    state.requests.cancel(window.label());
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
/// `paste` 为 true 时对应 ⌘⇧Enter：写剪贴板 → 收起撰写窗 → 把唤出撰写窗之前的应用
/// 叫回前台、确认它确实在前台后再粘贴。确认不了（从 umuo 自己的窗口唤出、原应用已退出）
/// 就只留在剪贴板里并提示，不往不知道是谁的窗口里 ⌘V。
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
    let owner = state
        .compose_owner
        .lock()
        .expect("撰写窗目标锁不应中毒")
        .clone();
    // 把唤出撰写窗之前的应用叫回前台，轮询到它真的在前台再粘贴。固定等一段时间不够：
    // 撰写窗收起后接过焦点的可能是 umuo 自己的历史窗或设置窗，⌘V 会落进那里。
    let back_in_owner = match owner.as_deref() {
        Some(owner) => {
            refocus_source_app(selection, owner).await;
            selection.frontmost_app_token().as_deref() == Some(owner)
        }
        None => false,
    };
    if !back_in_owner {
        let message = "译文已复制到剪贴板，但原来的应用没能回到前台，没有自动粘贴。可以手动 ⌘V。";
        // 撰写窗已经收起，它自己的提示没人看得见：用浮窗说。
        translator::emit_notice(&app, message, None);
        return Err(message.to_string());
    }
    selection.paste_clipboard().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- 多模型对比（PRD §5.6）

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
    ops::record_compare_pick(&state, &provider_id, &model)
}

#[tauri::command]
pub fn compare_picks(state: State<'_, AppState>) -> Vec<PickDto> {
    ops::picks_from(&state)
}

// ---------------------------------------------------------------- 翻译历史（PRD §5.9）

#[tauri::command]
pub fn history_query(
    state: State<'_, AppState>,
    filter: Option<HistoryFilterDto>,
    limit: u32,
    offset: u32,
) -> Result<Vec<RecordDto>, String> {
    ops::history_query(&state, filter, limit, offset)
}

#[tauri::command]
pub fn history_facets(state: State<'_, AppState>) -> Result<umuo_store::Facets, String> {
    ops::history_facets(&state)
}

#[tauri::command]
pub fn history_delete(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    ops::history_delete(&state, id)
}

#[tauri::command]
pub fn history_clear(state: State<'_, AppState>) -> Result<usize, String> {
    ops::history_clear(&state)
}

/// 本月的次数、token 与费用（PRD §5.10）。
#[tauri::command]
pub fn usage_summary(state: State<'_, AppState>) -> Result<UsageDto, String> {
    ops::usage_summary(&state)
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
pub fn usage_daily(
    state: State<'_, AppState>,
    days: u32,
) -> Result<Vec<umuo_store::DayUsage>, String> {
    ops::usage_daily(&state, days)
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

#[tauri::command]
pub fn quick_state(state: State<'_, AppState>) -> Result<QuickState, String> {
    Ok(ops::quick_state(
        &state,
        state.paused.load(Ordering::Relaxed),
    ))
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
    // 划词路径自己会开浮窗，这条入口不会：成功时也要看得到结果（审查 H3）。
    crate::translator::ensure_panel_shown(&app);
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
    // 从磁盘映像或隔离目录运行时直接说清楚怎么办，不包一层「写入失败」。
    if enabled {
        crate::autostart::check_launch_path(&exec)?;
    }
    crate::autostart::set_enabled(&home, &exec, enabled).map_err(|e| format!("写入失败：{e}"))?;
    Ok(crate::autostart::is_enabled(&home))
}

fn home_dir() -> Result<std::path::PathBuf, String> {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "读不到 HOME".to_string())
}

// ---------------------------------------------------------------- 配置导入导出（PRD §6.4）

/// 导出配置与术语表到固定位置，返回写出的完整路径。导出内容**不含 API Key**。
#[tauri::command]
pub fn export_config(state: State<'_, AppState>) -> Result<String, String> {
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "读不到 HOME，无法确定导出位置".to_string())?;
    ops::export_config(&state, &home)
}

/// 从文件导入配置与术语表，返回"应用了什么"的摘要。**不碰 Keychain**：
/// 新机器上导完之后仍需自己填 Key——界面要把这句话说清楚。
#[tauri::command]
pub fn import_config(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<crate::config_io::ImportSummary, String> {
    let imported = ops::import_config(&state, std::path::Path::new(&path))?;
    run_settings_effects(&app, &imported.settings, imported.effects);
    Ok(imported.summary)
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

#[tauri::command]
pub fn glossary_list(state: State<'_, AppState>) -> Vec<umuo_core::glossary::Glossary> {
    ops::glossary_list(&state)
}

#[tauri::command]
pub fn glossary_save(
    state: State<'_, AppState>,
    glossary: umuo_core::glossary::Glossary,
) -> Result<Vec<umuo_core::glossary::Glossary>, String> {
    ops::glossary_save(&state, glossary)
}

#[tauri::command]
pub fn glossary_remove(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<umuo_core::glossary::Glossary>, String> {
    ops::glossary_remove(&state, &id)
}

#[tauri::command]
pub fn glossary_import(
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<usize, String> {
    ops::glossary_import(&state, &id, &text)
}

#[tauri::command]
pub fn glossary_export(state: State<'_, AppState>, id: String) -> Result<String, String> {
    ops::glossary_export(&state, &id)
}

// ---------------------------------------------------------------- 月度上限（PRD §5.10）

/// 本月各供应商的花费，供设置页显示「已用 x / 上限 y」。
#[tauri::command]
pub fn monthly_spend(state: State<'_, AppState>) -> Result<Vec<umuo_store::ProviderUsage>, String> {
    ops::monthly_spend(&state)
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

/// 切换收藏状态，返回**切换之后**的状态（true = 现在已收藏）。
#[tauri::command]
pub fn favorite_toggle(
    state: State<'_, AppState>,
    text: String,
    translation: Option<String>,
) -> Result<bool, String> {
    ops::favorite_toggle(&state, &text, translation)
}

/// 一次问完若干条文本当前是否已收藏（历史列表一屏一百来行，不逐行往返）。
#[tauri::command]
pub fn favorites_status(
    state: State<'_, AppState>,
    texts: Vec<String>,
) -> Result<Vec<bool>, String> {
    ops::favorites_status(&state, &texts)
}

#[tauri::command]
pub fn favorites_list(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
) -> Result<Vec<FavoriteDto>, String> {
    ops::favorites_list(&state, limit, offset)
}

#[tauri::command]
pub fn favorite_remove(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    ops::favorite_remove(&state, id)
}
