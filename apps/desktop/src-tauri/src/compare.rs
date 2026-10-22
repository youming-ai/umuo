//! 多模型对比（PRD §5.6）的外壳一侧：快捷键 / 命令入口、取词与开窗。
//!
//! 候选规划与 N 路并发的流水线本体在 [`umuo_app::compare`]，这里只登记请求、取词、
//! 打开对比窗，再把流水线放到 Tauri 的运行时上跑，事件经 [`TauriSink`](crate::sink::TauriSink) 发出。

use tauri::{AppHandle, Manager};
use umuo_app::event::{CompareEvent, CompareNoticePayload as NoticePayload, CompareSink};
use umuo_platform::SelectionReader;

use crate::requests::Ticket;
use crate::{AppState, COMPARE_LABEL};

/// 发一个 compare:// 事件到对比窗。
fn emit(app: &AppHandle, event: impl Into<CompareEvent>) {
    crate::sink::TauriSink(app.clone()).send(event.into());
}

/// 快捷键 / 托盘触发的入口。取词与划词翻译同源（选区优先，失败降级复制）。
///
/// 按下快捷键就顶掉上一轮：上一轮最多 4 路计费请求不该在看不见的地方继续跑。
pub fn trigger(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let ticket = app.state::<AppState>().requests.begin(COMPARE_LABEL);
        let read = app.state::<AppState>().selection.read_selection();
        let text = match read {
            Ok(text) => text,
            Err(error) => {
                crate::show_compare(&app);
                emit_notice(&app, ticket.id, error.to_string());
                return;
            }
        };
        crate::show_compare(&app);
        tauri::async_runtime::spawn(run(app, text, ticket));
    });
}

/// 从命令（撰写窗之外的入口）发起一次对比。
pub fn spawn(app: &AppHandle, text: String) {
    let ticket = app.state::<AppState>().requests.begin(COMPARE_LABEL);
    tauri::async_runtime::spawn(run(app.clone(), text, ticket));
}

async fn run(app: AppHandle, text: String, ticket: Ticket) {
    let sink = crate::sink::TauriSink(app.clone());
    umuo_app::compare::run(&crate::core(&app), &sink, text, ticket).await;
}

fn emit_notice(app: &AppHandle, run_id: u64, message: String) {
    emit(app, NoticePayload { run_id, message });
}
