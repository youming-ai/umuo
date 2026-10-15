//! 取词与写回。

use std::time::Duration;

use umuo_platform::{Clipboard, PlatformError, SelectionReader};

use crate::ax;
use crate::clipboard::MacClipboard;
use crate::key_event;

/// 降级路径轮询剪贴板的节奏。20ms × 20 次 ≈ 400ms 上限：
/// 再长会让用户觉得「快捷键按下去没反应」，再短则可能在慢 App 里读空。
const CLIPBOARD_POLL_INTERVAL: Duration = Duration::from_millis(20);
const CLIPBOARD_POLL_ATTEMPTS: u32 = 20;

/// 降级所需权限的展示名，用于把用户引到正确的系统设置面板。
const ACCESSIBILITY: &str = "辅助功能";

pub struct MacSelection;

impl MacSelection {
    /// 模拟 ⌘C 取词：AX 拿不到选区时的兜底。
    ///
    /// 这是**唯一**会动用户剪贴板的地方，所以整段逻辑都围绕「怎么把剪贴板还回去」
    /// 与「怎么不误判」展开。
    fn read_via_clipboard(&self) -> Result<String, PlatformError> {
        let clipboard = MacClipboard;
        let snapshot = clipboard.read_text();

        // 先清空再复制。否则当剪贴板内容恰好等于选中内容时，
        // 我们无法区分「复制成功了」和「复制根本没生效，读到的还是旧内容」。
        clipboard.write_text("")?;
        key_event::copy()?;

        let mut captured: Option<String> = None;
        for _ in 0..CLIPBOARD_POLL_ATTEMPTS {
            std::thread::sleep(CLIPBOARD_POLL_INTERVAL);
            if let Some(text) = clipboard.read_text() {
                if !text.is_empty() {
                    captured = Some(text);
                    break;
                }
            }
        }

        // 把用户的剪贴板还回去（PRD §5.2）。恢复失败不能连累取词结果——
        // 用户至少还能用上这次翻译。
        if let Some(original) = snapshot {
            let _ = clipboard.write_text(&original);
        }

        captured.ok_or(PlatformError::NoSelection)
    }
}

impl SelectionReader for MacSelection {
    fn read_selection(&self) -> Result<String, PlatformError> {
        if !ax::is_trusted() {
            return Err(PlatformError::PermissionDenied {
                capability: ACCESSIBILITY,
            });
        }

        // 首选：Accessibility，只读、不产生任何副作用。
        if let Some(text) = ax::selected_text() {
            if !text.trim().is_empty() {
                return Ok(text);
            }
        }

        // 兜底：模拟复制。Electron / Java / 远程桌面里的 App 常常走这条。
        self.read_via_clipboard()
    }

    fn read_focus_text(&self) -> Result<String, PlatformError> {
        if !ax::is_trusted() {
            return Err(PlatformError::PermissionDenied {
                capability: ACCESSIBILITY,
            });
        }

        // 选中了什么就翻什么。
        if let Some(text) = ax::selected_text() {
            if !text.trim().is_empty() {
                return Ok(text);
            }
        }

        // 没选中就是「把整个输入框翻一遍」——用户按 ⌥⇧T 时常常什么都不选。
        match ax::focused_value() {
            Some(text) if !text.trim().is_empty() => Ok(text),
            _ => Err(PlatformError::NoSelection),
        }
    }

    fn replace_selection(&self, text: &str) -> Result<(), PlatformError> {
        if !ax::is_trusted() {
            return Err(PlatformError::PermissionDenied {
                capability: ACCESSIBILITY,
            });
        }

        // 首选仍是 AX：直接改写选区，不碰剪贴板。
        if ax::set_selected_text(text) {
            return Ok(());
        }

        // 兜底：写剪贴板 + ⌘V。这条路会把剪贴板内容换成译文，
        // 但「原地替换」这个动作本身就意味着用户想把这段译文粘出去，
        // 所以这里不做恢复——恢复了反而会让紧接着的粘贴拿到旧内容。
        let clipboard = MacClipboard;
        clipboard.write_text(text)?;
        key_event::paste()
    }

    fn frontmost_app_token(&self) -> Option<String> {
        // 用 pid 当标识：只需要「同一焦点前后两次相等」，不需要跨进程稳定。
        ax::frontmost_pid().map(|pid| pid.to_string())
    }

    fn frontmost_app_name(&self) -> Option<String> {
        ax::frontmost_app_name()
    }

    fn paste_clipboard(&self) -> Result<(), PlatformError> {
        key_event::paste()
    }

    fn is_trusted(&self) -> bool {
        ax::is_trusted()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "需要真实的辅助功能权限与前台选区，手动运行：cargo test -p umuo-platform-macos -- --ignored"]
    fn reading_a_real_selection_returns_text() {
        let selection = MacSelection;
        assert!(
            selection.is_trusted(),
            "运行前请先给终端/应用开启辅助功能权限"
        );
        assert!(!selection.read_selection().unwrap().trim().is_empty());
    }

    #[test]
    #[ignore = "需要有焦点输入框，手动运行：cargo test -p umuo-platform-macos -- --ignored"]
    fn permission_state_is_reported_consistently() {
        // 这条断言的价值在于暴露「权限没开」这类环境问题，而不是业务逻辑。
        assert_eq!(MacSelection.is_trusted(), ax::is_trusted());
    }
}
