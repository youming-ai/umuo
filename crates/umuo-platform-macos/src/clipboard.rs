//! 剪贴板。
//!
//! 纯文本的读写走 arboard。每次操作都新建一个 `arboard::Clipboard`：它内部持有平台句柄且不保证 `Send`，
//! 而我们希望这个类型是 `Send + Sync`（要放进 Tauri 的全局状态里）。
//! 新建的开销在「一次取词」这个尺度上可以忽略。
//!
//! ⌘C 取词降级要的是「整块剪贴板原样存下、原样还回去」，这个 arboard 做不到，
//! 直接用 NSPasteboard（见 [`Snapshot`]）。

use std::sync::{Mutex, MutexGuard, PoisonError};

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString, NSPasteboardWriting};
use objc2_foundation::{NSArray, NSData, NSString};
use umuo_platform::{Clipboard, PlatformError};

pub struct MacClipboard;

/// 动剪贴板的操作互斥：⌘C 取词降级（快照 → 清空 → ⌘C → 轮询 → 恢复 → 观察迟到的复制）
/// 是一整个事务，期间别的线程写剪贴板，要么被它的恢复盖掉，要么被它当成原内容存下来。
/// 连按两次快捷键时，第二次的快照拿到的会是第一次清空后的空剪贴板，最后用空串盖掉用户的内容。
static EXCLUSIVE: Mutex<()> = Mutex::new(());

/// 拿到剪贴板的独占权。中毒了也照常用：锁里没有要保护的数据，
/// 一次 panic 不该让取词从此再也用不了。
pub(crate) fn exclusive() -> MutexGuard<'static, ()> {
    EXCLUSIVE.lock().unwrap_or_else(PoisonError::into_inner)
}

/// 不加锁的写入：调用方已经拿着 [`exclusive`]。
pub(crate) fn set_text(text: &str) -> Result<(), PlatformError> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| PlatformError::Clipboard(e.to_string()))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|e| PlatformError::Clipboard(e.to_string()))
}

impl Clipboard for MacClipboard {
    fn read_text(&self) -> Option<String> {
        // 剪贴板里是图片/文件时，arboard 会返回错误——这里语义上等于「没有文本」，
        // 所以吞掉错误返回 None，而不是往上抛。
        let mut clipboard = arboard::Clipboard::new().ok()?;
        clipboard.get_text().ok()
    }

    fn write_text(&self, text: &str) -> Result<(), PlatformError> {
        let _exclusive = exclusive();
        set_text(text)
    }
}

/// 剪贴板的修改计数。每次有人写剪贴板（包括清空）它都会变，用来判断「是不是有人动过」。
pub(crate) fn change_count() -> isize {
    NSPasteboard::generalPasteboard().changeCount()
}

/// 清空剪贴板，返回清空之后的修改计数。
pub(crate) fn clear() -> isize {
    NSPasteboard::generalPasteboard().clearContents()
}

/// 剪贴板上的纯文本。
pub(crate) fn read_string() -> Option<String> {
    // SAFETY: NSPasteboardTypeString 是 AppKit 导出的常量。
    let string_type = unsafe { NSPasteboardTypeString };
    NSPasteboard::generalPasteboard()
        .stringForType(string_type)
        .map(|text| text.to_string())
}

/// 剪贴板上全部内容的快照：每个 item 的每种类型（UTI）与原始字节。
///
/// 只存文本的话，用户刚复制的截图、文件、带格式的文字都会在一次取词之后丢掉。
/// 存成普通的 Rust 数据而不是 NSData：好测，也不用操心 Objective-C 对象能不能跨线程。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Snapshot {
    items: Vec<Vec<(String, Vec<u8>)>>,
}

impl Snapshot {
    pub(crate) fn take() -> Self {
        let pasteboard = NSPasteboard::generalPasteboard();
        let Some(items) = pasteboard.pasteboardItems() else {
            return Self::default();
        };
        let items = items
            .iter()
            .map(|item| {
                item.types()
                    .iter()
                    // 取不到数据的类型（延迟提供、已失效的承诺）跳过，其余照存。
                    .filter_map(|kind| {
                        let data = item.dataForType(&kind)?;
                        Some((kind.to_string(), data.to_vec()))
                    })
                    .collect()
            })
            .collect();
        Self { items }
    }

    /// 原样写回。原来是空的就清空——否则这次复制到的选中文本会留在剪贴板上。
    pub(crate) fn restore(&self) {
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.clearContents();
        if self.items.is_empty() {
            return;
        }
        let items: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = self
            .items
            .iter()
            .map(|types| {
                let item = NSPasteboardItem::new();
                for (kind, bytes) in types {
                    item.setData_forType(&NSData::with_bytes(bytes), &NSString::from_str(kind));
                }
                ProtocolObject::from_retained(item)
            })
            .collect();
        pasteboard.writeObjects(&NSArray::from_retained_slice(&items));
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

    #[test]
    #[ignore = "会改写真实剪贴板，手动运行：cargo test -p umuo-platform-macos -- --ignored"]
    fn a_snapshot_restores_every_item_and_type() {
        let _exclusive = exclusive();
        let original = Snapshot {
            items: vec![
                vec![
                    ("public.utf8-plain-text".into(), b"umuo".to_vec()),
                    ("public.html".into(), b"<b>umuo</b>".to_vec()),
                ],
                vec![("public.png".into(), vec![0x89, b'P', b'N', b'G'])],
            ],
        };
        original.restore();
        assert_eq!(Snapshot::take(), original);
        // 原来是空的：恢复之后也必须是空的，不能留下别的内容。
        Snapshot::default().restore();
        assert_eq!(Snapshot::take(), Snapshot::default());
    }
}
