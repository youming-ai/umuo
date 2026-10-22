//! 自动更新（tauri-plugin-updater）。
//!
//! 清单在 `https://umuo.app/download/macos/update.json`（官网 Worker 从 R2 读出），
//! 安装包是 Release 工作流产出的 `.app.tar.gz`，用 minisign 签名；公钥在 `tauri.conf.json`。
//!
//! 交互只占托盘菜单里的**一个条目**，文字就是状态：检查 → 下载 → 「重启以更新」。
//! 启动时静默查一次，有新版就直接下载装好，等用户自己点重启——翻译到一半被重启比晚一点更新糟得多。
//! 装好之后不重启也没关系：`.app` 已被替换，下次启动就是新版。
//!
//! ponytail: 没有更新说明窗口，也不定时轮询；常驻菜单栏的应用开着不关时只能手动查。
//! 要定时就在 `spawn_startup_check` 里加个间隔循环。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::MenuItem;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_updater::UpdaterExt;

pub const MENU_ID: &str = "update";
pub const IDLE_TEXT: &str = "检查更新…";

/// 托盘里那个条目，以及「已装好、等重启」的版本号。
pub struct UpdateMenu {
    item: MenuItem<Wry>,
    busy: AtomicBool,
    ready: Mutex<Option<String>>,
}

impl UpdateMenu {
    pub fn new(item: MenuItem<Wry>) -> Self {
        Self {
            item,
            busy: AtomicBool::new(false),
            ready: Mutex::new(None),
        }
    }

    fn show(&self, text: &str, enabled: bool) {
        let _ = self.item.set_text(text);
        let _ = self.item.set_enabled(enabled);
    }
}

/// 菜单点击：已装好就重启，否则查一次。
pub fn on_click(app: &AppHandle) {
    let ready = app
        .state::<UpdateMenu>()
        .ready
        .lock()
        .map(|r| r.is_some())
        .unwrap_or(false);
    if ready {
        app.restart();
    }
    check(app, true);
}

/// 启动后查一次。错开一会儿，不和启动时的初始化、引导窗抢。
pub fn spawn_startup_check(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        check(&app, false);
    });
}

/// `manual`：用户点的就把「已是最新 / 失败」写在条目上；启动时静默查的不打扰。
fn check(app: &AppHandle, manual: bool) {
    // 开发构建不是一个 .app，更新会去替换 target/debug 下的东西
    if cfg!(debug_assertions) {
        if manual {
            app.state::<UpdateMenu>().show("开发构建不检查更新", false);
        }
        return;
    }
    let menu = app.state::<UpdateMenu>();
    if menu.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    menu.show("正在检查更新…", false);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let menu = app.state::<UpdateMenu>();
        match run(&app, &menu).await {
            Ok(Some(version)) => {
                menu.show(&format!("重启以更新到 {version}"), true);
                if let Ok(mut ready) = menu.ready.lock() {
                    *ready = Some(version);
                }
            }
            Ok(None) if manual => menu.show("已是最新版本（再次检查）", true),
            Ok(None) => menu.show(IDLE_TEXT, true),
            Err(error) => {
                eprintln!("umuo: 检查更新失败：{error}");
                menu.show(
                    if manual {
                        "检查更新失败（重试）"
                    } else {
                        IDLE_TEXT
                    },
                    true,
                );
            }
        }
        menu.busy.store(false, Ordering::SeqCst);
    });
}

/// 有新版就下载并安装，返回装好的版本号。
async fn run(app: &AppHandle, menu: &UpdateMenu) -> tauri_plugin_updater::Result<Option<String>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    menu.show(&format!("正在下载 {}…", update.version), false);
    update.download_and_install(|_, _| {}, || {}).await?;
    Ok(Some(update.version))
}
