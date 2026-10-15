//! 剪贴板（arboard）。
//!
//! 每次操作都新建一个 `arboard::Clipboard`：它内部持有平台句柄且不保证 `Send`，
//! 而我们希望这个类型是 `Send + Sync`（要放进 Tauri 的全局状态里）。
//! 新建的开销在「一次取词」这个尺度上可以忽略。

use umuo_platform::{Clipboard, PlatformError};

pub struct MacClipboard;

impl Clipboard for MacClipboard {
    fn read_text(&self) -> Option<String> {
        // 剪贴板里是图片/文件时，arboard 会返回错误——这里语义上等于「没有文本」，
        // 所以吞掉错误返回 None，而不是往上抛。
        let mut clipboard = arboard::Clipboard::new().ok()?;
        clipboard.get_text().ok()
    }

    fn write_text(&self, text: &str) -> Result<(), PlatformError> {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| PlatformError::Clipboard(e.to_string()))?;
        clipboard
            .set_text(text.to_string())
            .map_err(|e| PlatformError::Clipboard(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "会改写真实剪贴板，手动运行：cargo test -p umuo-platform-macos -- --ignored"]
    fn write_then_read_round_trips_through_the_real_clipboard() {
        let clipboard = MacClipboard;
        clipboard.write_text("umuo-clipboard-probe").unwrap();
        assert_eq!(
            clipboard.read_text().as_deref(),
            Some("umuo-clipboard-probe")
        );
    }
}
