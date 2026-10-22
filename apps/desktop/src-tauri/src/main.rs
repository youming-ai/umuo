//! umuo 桌面客户端外壳。
//!
//! 这个文件只做四件事：**建窗口、建托盘、注册快捷键、把依赖装进状态**。
//! 翻译逻辑一律在 `umuo-core`，平台能力一律在 `umuo-platform-macos`。
//!
//! 窗口刻意不在 `tauri.conf.json` 里声明，而是运行时创建：
//! 浮窗要配一堆 macOS 特有的属性（透明、置顶、不进任务栏、不抢焦点），
//! 运行时代码比 JSON 更能把这些意图写清楚。

// 与窗口系统无关的应用层已搬进 `umuo-app`（Tauri 与以后的 SwiftUI 客户端共用）。
// 重新导出后 `crate::settings::…` 这类路径照旧可用，外壳代码不用改。
pub use umuo_app::{budget, config_io, glossaries, history, persist, requests, settings, stats};

mod autostart;
mod commands;
mod compare;
mod double_tap;
mod host_mac;
#[cfg(test)]
mod pipeline_tests;
mod screenshot;
#[cfg(test)]
mod settings_hotkey_test;
mod sink;
mod translator;
mod updater;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use umuo_platform::SelectionReader;
use umuo_platform_macos::{MacOcr, MacScreenCapture, MacSecretStore, MacSelection, MacSpeech};

use settings::Settings;

// 浮窗与撰写窗的标签由翻译流水线决定事件发往哪里，所以以 `umuo-app` 为准，这里只取别名。
pub const PANEL_LABEL: &str = umuo_app::translate::PANEL_SURFACE;
pub const SETTINGS_LABEL: &str = "settings";
/// 撰写窗（PRD §5.3）。三个功能共用同一套事件协议，靠窗口标签区分收件人。
pub const COMPOSE_LABEL: &str = umuo_app::translate::COMPOSE_SURFACE;
/// 多模型对比窗（PRD §5.6）。
pub const COMPARE_LABEL: &str = "compare";
/// 翻译历史窗（PRD §5.9）。
pub const HISTORY_LABEL: &str = "history";
/// 首次启动引导窗（PRD §7.4）。
pub const ONBOARDING_LABEL: &str = "onboarding";
/// 菜单栏快捷面板（PRD §7.1）：最近翻译、快速输入、当前模型、暂停/恢复。
pub const QUICK_LABEL: &str = "quick";

/// 全局状态：所有命令与翻译流程共享的东西。
pub struct AppState {
    /// 两个客户端共用的那一半（设置、术语表、统计、历史库、HTTP 客户端、请求登记）。
    /// 经 `Deref` 直接访问：`state.settings` 就是 `state.core.settings`。
    pub core: Arc<umuo_app::AppCore>,
    pub selection: MacSelection,
    pub secrets: MacSecretStore,
    /// 屏幕捕获与 OCR（PRD §5.5）。两个都是无状态单元结构体。
    pub capture: MacScreenCapture,
    pub ocr: MacOcr,
    /// 发音朗读（系统语音合成）。
    pub speech: MacSpeech,
    /// 修饰键监听（连按两下快捷键用）；只在设了连按快捷键时才启动。
    pub modifier_monitor: umuo_platform_macos::MacModifierMonitor,
    /// 浮窗是否被钉住（PRD §7.1「可钉住」）。钉住时用户切走也不自动收起。
    pub panel_pinned: Arc<AtomicBool>,
    /// 当前浮窗里那次翻译「属于」哪个前台应用——看门狗据此判断用户是否切走。
    pub panel_owner: Mutex<Option<String>>,
    /// 唤出撰写窗时的前台应用：⌘⇧Enter 只往它里面粘贴。`None` = 是从 umuo 自己的窗口唤出的，
    /// 没有可以粘回去的外部应用。
    pub compose_owner: Mutex<Option<String>>,
    /// 暂停：暂停期间所有全局快捷键都不响应（PRD §7.1 快捷面板的「暂停/恢复」）。
    ///
    /// 场景是「我要用这个组合键干别的」——比如在游戏里、或临时和别的应用抢键位。
    /// 退掉客户端太重，改快捷键又太麻烦。
    pub paused: Arc<AtomicBool>,
    /// 注册全局快捷键时**被系统拒绝**的那些（PRD §7.2 的冲突提示）。
    ///
    /// macOS 对已被别的应用占用的快捷键是**静默拒绝**：不报错、不提示，
    /// 用户的感受就是"这个键没反应"。所以要把结果记下来并摆到设置页上。
    pub hotkey_failures: Mutex<Vec<String>>,
    /// 设置窗正在「录快捷键」的截止时间：期间所有全局快捷键不响应，免得录 ⌃⌃ 时顺手触发翻译。
    /// 用截止时间而不是开关：录到一半窗口被关掉，最多几十秒后自动恢复，不会让快捷键永久失灵。
    pub recording_until: Mutex<Option<std::time::Instant>>,
}

// 过渡用：外壳里大量 `state.settings` / `state.store` 不必逐处改成 `state.core.…`。
// Tauri 外壳删除时（迁移阶段 6）这个 impl 随之删除。
impl std::ops::Deref for AppState {
    type Target = umuo_app::AppCore;
    fn deref(&self) -> &Self::Target {
        &self.core
    }
}

/// 取应用层状态。给只拿得到 `AppHandle` 的地方用（`history::*`、`budget::resolve` 等）。
pub fn core(app: &tauri::AppHandle) -> Arc<umuo_app::AppCore> {
    app.state::<AppState>().core.clone()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let config_dir = handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let core = umuo_app::AppCore::open(config_dir, Arc::new(host_mac::MacHost))?;
            let settings = core.settings.lock().expect("设置锁不应中毒").clone();

            app.manage(AppState {
                core: Arc::new(core),
                selection: MacSelection,
                secrets: MacSecretStore,
                capture: MacScreenCapture,
                ocr: MacOcr,
                speech: MacSpeech::new(),
                modifier_monitor: umuo_platform_macos::MacModifierMonitor::new(),
                panel_pinned: Arc::new(AtomicBool::new(false)),
                panel_owner: Mutex::new(None),
                compose_owner: Mutex::new(None),
                paused: Arc::new(AtomicBool::new(false)),
                hotkey_failures: Mutex::new(Vec::new()),
                recording_until: Mutex::new(None),
            });

            // 常驻菜单栏、不占 Dock（PRD §7）。这个调用在 macOS 上返回 ()，
            // 所以不加 `let _ =`——那会被 clippy 判为无意义的绑定。
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            build_panel(&handle)?;
            build_compose(&handle)?;
            build_compare(&handle)?;
            build_tray(&handle, &settings)?;
            register_hotkeys(&handle, &settings);
            spawn_panel_watcher(&handle);
            updater::spawn_startup_check(&handle);

            // 首次启动引导（PRD §7.4）。**错开 400 ms**：托盘图标、快捷键、
            // 浮动窗都还在初始化，抢在前面弹窗会显得客户端「一启动就弹东西」。
            if !settings.onboarding_done {
                let handle = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    let _ = commands::open_onboarding(handle);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::provider_catalog,
            commands::key_status,
            commands::save_api_key,
            commands::delete_api_key,
            commands::list_models,
            commands::accessibility_trusted,
            commands::style_catalog,
            commands::open_accessibility_settings,
            commands::copy_text,
            commands::translate_text,
            commands::cancel_translation,
            commands::hide_panel,
            commands::open_settings,
            commands::open_external,
            commands::toggle_compose,
            commands::hide_compose,
            commands::compose_translate,
            commands::compose_back_translate,
            commands::compose_commit,
            commands::compare_translate,
            commands::hide_compare,
            commands::record_compare_pick,
            commands::compare_picks,
            commands::history_query,
            commands::history_facets,
            commands::history_delete,
            commands::history_clear,
            commands::usage_summary,
            commands::open_history,
            commands::usage_daily,
            commands::favorite_toggle,
            commands::favorites_status,
            commands::favorites_list,
            commands::favorite_remove,
            commands::ocr_permission,
            commands::ocr_request_permission,
            commands::open_screen_recording_settings,
            commands::monthly_spend,
            commands::glossary_list,
            commands::glossary_save,
            commands::glossary_remove,
            commands::glossary_import,
            commands::glossary_export,
            commands::speak_text,
            commands::stop_speaking,
            commands::app_version,
            commands::quick_state,
            commands::set_paused,
            commands::quick_translate,
            commands::hotkey_failures,
            commands::set_hotkey_recording,
            commands::autostart_status,
            commands::set_autostart,
            commands::export_config,
            commands::import_config,
            commands::open_onboarding,
            commands::finish_onboarding,
            commands::configured_providers,
            commands::retranslate,
            commands::replace_source,
            commands::open_compose_with,
            commands::panel_pinned,
            commands::panel_set_pinned,
        ])
        .run(tauri::generate_context!())
        .expect("umuo 启动失败");
}

/// 浮窗：无边框、透明、置顶、不进任务栏、出现时不抢焦点。
///
/// 「不抢焦点」是这里最要紧的一条：用户按 ⌥D 是想看译文，
/// 不是想把自己的编辑焦点从正在写的文档里挪走。
/// 启动时先 `visible(false)`，等真正要显示时再定位——避免在屏幕角落闪一下。
fn build_panel(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(PANEL_LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, PANEL_LABEL, WebviewUrl::App("panel.html".into()))
        .title("umuo")
        .inner_size(420.0, 260.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        // PRD §5.2 要求浮窗「可调整大小」。给一个下限避免被拖成一条缝。
        .resizable(true)
        .min_inner_size(320.0, 150.0)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()?;
    Ok(())
}

/// 浮窗的「切走就收起」看门狗（PRD §7.1：失焦关闭，可钉住）。
///
/// 为什么轮询而不是听事件：浮窗是非激活窗口，创建时不接受焦点，
/// 没有可靠的 blur 事件可用。500 ms 一次、且只在浮窗可见时才查，
/// 代价是一次 AX 调用，可以忽略。
///
/// 判据本身是纯函数 `translator::should_auto_hide`（有测试），
/// 这里只负责取数、判断、收起。
fn spawn_panel_watcher(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let Some(panel) = app.get_webview_window(PANEL_LABEL) else {
            continue;
        };
        if !panel.is_visible().unwrap_or(false) {
            continue;
        }
        let state = app.state::<AppState>();
        let pinned = state.panel_pinned.load(Ordering::Relaxed);
        let owner = state
            .panel_owner
            .lock()
            .expect("浮窗归属锁不应中毒")
            .clone();
        let current = state.selection.frontmost_app_token();
        if translator::should_auto_hide(
            pinned,
            owner.as_deref(),
            current,
            &translator::own_app_token(),
        ) {
            let _ = panel.hide();
        }
    });
}

/// 撰写窗：无边框、居中、可缩放。
///
/// 与浮窗相反，它**要**抢焦点——用户按 ⌥A 就是为了打字。尺寸与形态参照
/// PRD §7.1 的「居中浮窗，类 Spotlight」。
fn build_compose(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(COMPOSE_LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, COMPOSE_LABEL, WebviewUrl::App("compose.html".into()))
        .title("umuo 撰写")
        .inner_size(660.0, 440.0)
        .min_inner_size(520.0, 320.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .center()
        .visible(false)
        .build()?;
    Ok(())
}

/// 显示撰写窗并聚焦。
///
/// 「在撰写窗打开」要的是**显示**而不是切换：用户从浮窗点过来时，
/// 撰写窗如果已经开着，切换会把它收起来——正好相反。
/// 粘贴目标由调用方 `open_compose_with` 按来源重新计算，这里不记。
pub fn show_compose(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(COMPOSE_LABEL) else {
        return;
    };
    let _ = window.center();
    let _ = window.show();
    let _ = window.set_focus();
}

/// 唤出撰写窗**之前**记下前台应用：⌘⇧Enter 要粘回的是它。撰写窗收起后接过焦点的
/// 可能是 umuo 自己的历史窗或设置窗，不记的话译文会被粘进那里的输入框。
fn remember_compose_owner(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let owner = compose_owner(state.selection.frontmost_app_token(), std::process::id());
    *state.compose_owner.lock().expect("撰写窗目标锁不应中毒") = owner;
}

/// 前台是 umuo 自己（从历史窗「再次编辑」等）时没有外部目标。抽成纯函数是为了能测。
pub(crate) fn compose_owner(token: Option<String>, own_pid: u32) -> Option<String> {
    token.filter(|token| *token != own_pid.to_string())
}

/// `open_compose_with` 用：每次都按**这一次**的来源重新算粘贴目标，不保留旧值——
/// 撰写窗置顶、失焦不收起，一直开着时旧值可能是很早以前唤出它的无关应用。
/// - 调用方是浮窗：原文来自浮窗归属的应用，优先粘回那里；归属是 umuo 自己
///   （截图翻译等）时才退回当前前台。
/// - 其他 umuo 窗口（历史窗「再次编辑」等）：只认当前前台的外部应用，通常为 `None`。
///   浮窗归属在浮窗收起后不会清掉，可能早已过时，不能拿来用。
pub(crate) fn compose_owner_for_caller(
    frontmost: Option<String>,
    caller_label: &str,
    panel_owner: Option<String>,
    own_pid: u32,
) -> Option<String> {
    let frontmost = compose_owner(frontmost, own_pid);
    if caller_label == PANEL_LABEL {
        compose_owner(panel_owner, own_pid).or(frontmost)
    } else {
        frontmost
    }
}

/// ⌥A 与托盘共用：可见就收起，不可见就居中唤出并聚焦。
pub fn toggle_compose(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(COMPOSE_LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    remember_compose_owner(app);
    // 每次唤出都重新居中：用户可能刚把窗口拖到别的屏幕。
    let _ = window.center();
    let _ = window.show();
    let _ = window.set_focus();
}

/// 对比窗：可缩放的普通浮层（PRD §7.1「对比窗：可调整大小的普通窗口」）。
///
/// 它比浮窗大得多——最多 4 张卡片横排，每张都要放得下一段译文与一行计量。
fn build_compare(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(COMPARE_LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, COMPARE_LABEL, WebviewUrl::App("compare.html".into()))
        .title("umuo 对比")
        .inner_size(1000.0, 460.0)
        .min_inner_size(640.0, 320.0)
        .decorations(true)
        .always_on_top(true)
        .visible(false)
        .build()?;
    Ok(())
}

/// 唤出对比窗（取词结束后调用）。窗口已开着时只做前置。
pub fn show_compare(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(COMPARE_LABEL) else {
        return;
    };
    let _ = window.show();
    let _ = window.set_focus();
}

/// 按设置里的样式取菜单栏图标（PRD §7.3「菜单栏图标样式」）。
///
/// 三份 PNG 都在编译期打进二进制；认不出来的样式回落模板——
/// 手改配置不该让托盘图标消失。
fn tray_icon_image(settings: &Settings) -> tauri::Result<tauri::image::Image<'static>> {
    // 参数名与 `settings` 模块同名是历史现状；这里用完整路径消除歧义。
    let style = crate::settings::normalize_tray_icon_style(&settings.tray_icon_style);
    let bytes: &[u8] = match style.as_str() {
        "brand" => include_bytes!("../icons/tray-brand.png"),
        "black" => include_bytes!("../icons/tray-black.png"),
        _ => include_bytes!("../icons/tray.png"),
    };
    tauri::image::Image::from_bytes(bytes)
}

/// 运行时切换托盘图标（设置改动时调用，不需要重启）。
pub fn apply_tray_style(app: &tauri::AppHandle, settings: &Settings) {
    let Ok(image) = tray_icon_image(settings) else {
        return;
    };
    // 非模板图标要关掉 is_template，否则系统会用菜单栏前景色重画，
    // 彩色水獭就没了。
    let is_template = settings.tray_icon_style == "template";
    if let Some(tray) = app.tray_by_id("umuo-tray") {
        let _ = tray.set_icon(Some(image));
        // 模板标志在 TrayIcon 上而不是图片上：同一份 PNG，
        // 模板样式交给系统着色，非模板保持原色。
        let _ = tray.set_icon_as_template(is_template);
    }
}

fn build_tray(app: &tauri::AppHandle, settings: &Settings) -> tauri::Result<()> {
    let translate = MenuItem::with_id(app, "translate", "翻译选中文本", true, None::<&str>)?;
    let silent = MenuItem::with_id(app, "silent", "输入框原地替换", true, None::<&str>)?;
    let compose = MenuItem::with_id(app, "compose", "撰写窗", true, None::<&str>)?;
    let compare_item = MenuItem::with_id(app, "compare", "多模型对比", true, None::<&str>)?;
    let screenshot_item = MenuItem::with_id(app, "screenshot", "截图翻译", true, None::<&str>)?;
    let silent_ocr_item = MenuItem::with_id(
        app,
        "silentOcr",
        "静默 OCR（只复制原文）",
        true,
        None::<&str>,
    )?;
    let quick_item = MenuItem::with_id(app, "quick", "快捷面板…", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let history_item = MenuItem::with_id(app, "history", "翻译历史", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let update_item = MenuItem::with_id(
        app,
        updater::MENU_ID,
        updater::IDLE_TEXT,
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "退出 umuo", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &translate,
            &silent,
            &compose,
            &compare_item,
            &screenshot_item,
            &silent_ocr_item,
            &separator,
            &quick_item,
            &history_item,
            &settings_item,
            &update_item,
            &quit,
        ],
    )?;

    app.manage(updater::UpdateMenu::new(update_item));

    TrayIconBuilder::with_id("umuo-tray")
        .icon(tray_icon_image(settings)?)
        // 模板图：交给系统按浅色/深色菜单栏着色，而不是自己画两套。
        .icon_as_template(settings.tray_icon_style == "template")
        .menu(&menu)
        // 左键点击不弹菜单：这个位置留给「立刻翻译选中文本」更符合肌肉记忆。
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quick" => commands::open_quick_panel(app, None),
            "translate" => translator::trigger(app),
            "silent" => translator::trigger_silent_replace(app),
            "compose" => toggle_compose(app),
            "compare" => compare::trigger(app),
            "screenshot" => screenshot::trigger(app),
            "silentOcr" => screenshot::trigger_silent(app),
            "history" => {
                let _ = commands::open_history(app.clone());
            }
            "settings" => {
                let _ = commands::open_settings(app.clone());
            }
            updater::MENU_ID => updater::on_click(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键开快捷面板（PRD §7.1）。**这里以前是空的**：
            // `show_menu_on_left_click(false)` 把左键留出来了，却没人接手，
            // 于是左键点图标什么都不发生。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                commands::open_quick_panel(tray.app_handle(), Some(position));
            }
        })
        .build(app)?;
    Ok(())
}

/// 设置里改了快捷键：在主线程上清掉全部旧注册、按新设置重注册，**不用重启**。
///
/// 只在快捷键字段真的变了时才调用（见 `save_settings`）——设置窗现在改了就存，
/// 每拨一个开关都重注册一遍会白白清空又重建失败记录。
pub fn reregister_hotkeys(app: &tauri::AppHandle, settings: Settings) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(error) = handle.global_shortcut().unregister_all() {
            eprintln!("umuo: 清除旧快捷键失败：{error}");
        }
        register_hotkeys(&handle, &settings);
        // 通知设置窗：重注册已完成，可以读新的失败清单了（比前端猜一个延时可靠）。
        let _ = handle.emit("hotkeys://registered", ());
    });
}

/// 现在是否在「录快捷键」（期间全局快捷键不响应）。
fn recording_hotkey(app: &tauri::AppHandle) -> bool {
    app.try_state::<AppState>()
        .and_then(|state| *state.recording_until.lock().expect("录键锁不应中毒"))
        .is_some_and(|until| std::time::Instant::now() < until)
}

/// 注册全局快捷键。
///
/// 每个快捷键各自的解析失败都回落到 PRD 的默认键位；**注册失败也不让启动失败**：
/// 一个被别的 App 占用的组合键不该把整个客户端拖垮（PRD §12.1「稳定性」）。
/// 失败记进 `hotkey_failures`（记的是设置字段名，界面按语言显示功能名、并标在那一行上）。
/// 一行快捷键配置：设置字段名、当前值、解析失败时回落的组合键、要触发的功能。
/// 回落只能是组合键，且只在值既不是连按、又解析不了时才用；⌃⌃ 这类连按监听起不来时不会回落，
/// 而是标成失败（见下面的 `set_bindings`）。连按默认的两行写旧版默认 ⌥D / ⌥⇧T 占位。
type HotkeyRow<'a> = (&'static str, &'a str, Shortcut, fn(&tauri::AppHandle));

fn register_hotkeys(app: &tauri::AppHandle, settings: &Settings) {
    use umuo_core::hotkey::{parse_hotkey, HotkeySpec};

    let fallback = |modifiers: Modifiers, code: Code| Shortcut::new(Some(modifiers), code);
    let table: [HotkeyRow<'_>; 7] = [
        (
            "selectionHotkey",
            &settings.selection_hotkey,
            fallback(Modifiers::ALT, Code::KeyD),
            translator::trigger,
        ),
        (
            "silentReplaceHotkey",
            &settings.silent_replace_hotkey,
            fallback(Modifiers::ALT | Modifiers::SHIFT, Code::KeyT),
            translator::trigger_silent_replace,
        ),
        (
            "composeHotkey",
            &settings.compose_hotkey,
            fallback(Modifiers::ALT | Modifiers::SUPER, Code::KeyA),
            toggle_compose,
        ),
        (
            "compareHotkey",
            &settings.compare_hotkey,
            fallback(Modifiers::ALT, Code::KeyP),
            compare::trigger,
        ),
        (
            "ocrHotkey",
            &settings.ocr_hotkey,
            fallback(Modifiers::ALT | Modifiers::SUPER, Code::KeyO),
            screenshot::trigger,
        ),
        (
            "ocrSilentHotkey",
            &settings.ocr_silent_hotkey,
            fallback(Modifiers::ALT | Modifiers::SHIFT, Code::KeyO),
            screenshot::trigger_silent,
        ),
        (
            "speakHotkey",
            &settings.speak_hotkey,
            fallback(Modifiers::ALT, Code::KeyR),
            translator::trigger_speak,
        ),
    ];

    let shortcuts = app.global_shortcut();
    // 每次注册前清空：用户在设置里改了快捷键会重新注册，旧的失败记录会过期。
    if let Some(state) = app.try_state::<AppState>() {
        state
            .hotkey_failures
            .lock()
            .expect("快捷键失败锁不应中毒")
            .clear();
    }

    // 连按两下修饰键（⌃⌃）**必须先分流出去**：交给全局快捷键插件解析会失败，
    // 然后悄悄回落到默认组合键——用户设了 ⌃⌃，实际生效的却是 ⌥D。
    let mut double_taps = Vec::new();
    for (field, value, default, handler) in table {
        match parse_hotkey(value) {
            HotkeySpec::DoubleTap(tap) => double_taps.push(double_tap::Binding {
                tap,
                field,
                handler,
            }),
            HotkeySpec::Combo(combo) => {
                let shortcut = combo.parse().unwrap_or(default);
                register_one(app, shortcuts, shortcut, field, handler);
            }
        }
    }

    let tap_fields: Vec<&'static str> = double_taps.iter().map(|binding| binding.field).collect();
    if let Err(error) = double_tap::set_bindings(app, double_taps) {
        eprintln!("umuo: 连按快捷键不可用：{error}");
        if let Some(state) = app.try_state::<AppState>() {
            let mut failures = state.hotkey_failures.lock().expect("快捷键失败锁不应中毒");
            failures.extend(tap_fields.iter().map(|field| field.to_string()));
        }
    }
}

/// 全局快捷键此刻是否应当不响应：用户点了「暂停」，或设置窗正在录快捷键。
/// 普通组合键与连按两下共用这一个判断，加新的快捷键类型时不必记得再判断一遍。
pub(crate) fn hotkeys_suspended(app: &tauri::AppHandle) -> bool {
    let paused = app
        .try_state::<AppState>()
        .is_some_and(|state| state.paused.load(Ordering::Relaxed));
    paused || recording_hotkey(app)
}

/// 注册一个全局快捷键，**失败时记下来**而不只是打日志（PRD §7.2 的冲突提示）。
///
/// macOS 对已被别的应用占用的快捷键是静默拒绝：不报错、不提示，
/// 用户的感受就是"这个键没反应"。日志他看不到，所以必须摆到设置页上。
fn register_one(
    app: &tauri::AppHandle,
    shortcuts: &tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>,
    shortcut: Shortcut,
    label: &str,
    handler: fn(&tauri::AppHandle),
) {
    let result = shortcuts.on_shortcut(shortcut, move |app, _shortcut, event| {
        if event.state() != ShortcutState::Pressed {
            return;
        }
        // 暂停与录键检查放在**这一处**而不是七个处理函数里：加一个快捷键时
        // 不需要记得「还要判断暂停」。
        if hotkeys_suspended(app) {
            return;
        }
        handler(app);
    });
    if let Err(error) = result {
        eprintln!("umuo: {label} 快捷键注册失败（可能已被其它应用占用）：{error}");
        if let Some(state) = app.try_state::<AppState>() {
            state
                .hotkey_failures
                .lock()
                .expect("快捷键失败锁不应中毒")
                .push(label.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_has_no_paste_target_when_umuo_itself_was_in_front() {
        // 从历史窗「再次编辑」唤出：前台是 umuo 自己，⌘⇧Enter 不该往那里粘贴。
        assert_eq!(compose_owner(Some("42".into()), 42), None);
        assert_eq!(compose_owner(None, 42), None);
        assert_eq!(compose_owner(Some("7".into()), 42), Some("7".into()));
    }

    #[test]
    fn compose_target_is_recomputed_from_caller_each_time() {
        let target = compose_owner_for_caller;
        // 浮窗点「在撰写窗打开」激活了 umuo：用浮窗归属的应用。
        assert_eq!(
            target(Some("42".into()), PANEL_LABEL, Some("7".into()), 42),
            Some("7".into())
        );
        // 撰写窗一直开着、当初由 A(9) 唤出，用户在 B(7) 划词后从浮窗打开：目标应为 B，
        // 前台是别的外部应用时也以浮窗归属为准。
        assert_eq!(
            target(Some("9".into()), PANEL_LABEL, Some("7".into()), 42),
            Some("7".into())
        );
        // 浮窗归属是 umuo 自己（截图翻译等）：退回当前前台的外部应用，没有就没有目标。
        assert_eq!(
            target(Some("9".into()), PANEL_LABEL, Some("42".into()), 42),
            Some("9".into())
        );
        assert_eq!(
            target(Some("42".into()), PANEL_LABEL, Some("42".into()), 42),
            None
        );
        // 历史窗「再次编辑」：浮窗归属可能早已过时，不能拿来当粘贴目标；前台是 umuo 自己时没有目标。
        assert_eq!(
            target(Some("42".into()), HISTORY_LABEL, Some("7".into()), 42),
            None
        );
    }
}
