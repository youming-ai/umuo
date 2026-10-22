//! 截图 OCR 的编排（PRD §5.5）。
//!
//! 链路：⌥S → 权限检查 → 系统框选 → 本机 Vision 识别 → 交给同一条翻译流水线。
//!
//! 三处刻意的取舍：
//!
//! 1. **识别走本机 Vision**，不把截图发给多模态模型。截图 OCR 是高频动作，
//!    每次上传一张图既慢又贵；而且用户截的往往就是自己屏幕上的东西。
//!    多模态识图留给「图片、复杂排版」那类 Vision 做不好的场景（PRD 里是可选项）。
//! 2. **用户取消不是错误**。按 Esc 取消框选是完全正常的操作，不该弹任何提示。
//! 3. **识别不到文字也不是错误**，但它需要一句明确的话——否则用户会以为
//!    快捷键没生效（截到纯色区域、图片时很常见）。

use tauri::{AppHandle, Manager};
use umuo_platform::capture::CapturePermission;
use umuo_platform::ocr::Ocr;
use umuo_platform::Clipboard;
use umuo_platform::ScreenCapture;

use crate::translator;
use crate::AppState;

/// 静默 OCR：识别完**只把原文复制到剪贴板**，不翻译、不弹窗（PRD §5.5）。
///
/// 「静默」是字面意思：成功了什么都不显示。用户按下快捷键、框选、然后去粘贴，
/// 中间不该有任何东西跳出来打断他。只有**失败**时才说话——否则用户不知道
/// 是自己没框准还是功能没生效。
pub fn trigger_silent(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let image = match capture(&app) {
            Ok(Some(image)) => image,
            // 用户取消。
            Ok(None) => return,
            Err(message) => {
                translator::emit_notice(&app, &message, None);
                return;
            }
        };

        let recognized = {
            let state = app.state::<AppState>();
            state.ocr.recognize(&image)
        };

        match recognized {
            Err(error) => {
                translator::emit_notice(&app, &format!("文字识别失败：{error}"), None);
            }
            Ok(result) if result.is_empty() => {
                translator::emit_notice(&app, "没有识别到文字，换一块区域再试", None);
            }
            Ok(result) => {
                // 复制失败是有意义的失败（剪贴板被占用等），所以它要说话。
                if let Err(error) = umuo_platform_macos::MacClipboard.write_text(&result.text) {
                    translator::emit_notice(&app, &format!("复制失败：{error}"), None);
                }
            }
        }
    });
}

/// 权限检查 + 系统框选。返回 `Ok(None)` 表示用户取消；`Err` 里是给用户看的原因。
fn capture(app: &AppHandle) -> Result<Option<umuo_platform::ScreenImage>, String> {
    let state = app.state::<AppState>();
    if state.capture.permission() == CapturePermission::Denied {
        translator::emit_notice(
            app,
            "需要「屏幕录制」权限才能截图翻译：系统设置 → 隐私与安全性 → 屏幕录制",
            Some("screenRecording"),
        );
        return Ok(None);
    }
    state
        .capture
        .capture_interactively()
        .map_err(|error| format!("截图失败：{error}"))
}

/// ⌥S 与托盘菜单的入口：框选 → 识别 → 翻译。
pub fn trigger(app: &AppHandle) {
    let app = app.clone();

    // 系统框选会一直阻塞到用户松开鼠标（或按 Esc），所以绝不能放在主线程上。
    std::thread::spawn(move || {
        let image = match capture(&app) {
            Ok(Some(image)) => image,
            // 用户取消：什么都不做，也不提示。
            Ok(None) => return,
            Err(message) => {
                translator::emit_notice(&app, &message, None);
                return;
            }
        };

        let recognized = {
            let state = app.state::<AppState>();
            state.ocr.recognize(&image)
        };

        match recognized {
            Err(error) => {
                translator::emit_notice(&app, &format!("文字识别失败：{error}"), None);
            }
            Ok(result) if result.is_empty() => {
                // 截到图片、纯色区域时很常见。要说清楚，否则用户以为快捷键没生效。
                translator::emit_notice(&app, "没有识别到文字，换一块区域再试", None);
            }
            Ok(result) => {
                // 识别结果作为源文本，走与划词翻译完全相同的那条流水线。
                // 先把浮窗开出来：成功时也要看得到结果（审查 H3）。
                translator::ensure_panel_shown(&app);
                translator::spawn(&app, translator::Request::ocr(result.text), None);
            }
        }
    });
}
