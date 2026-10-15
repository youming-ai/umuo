//! 剪贴板。

use crate::error::PlatformError;

/// 纯文本剪贴板。
///
/// 刻意只暴露文本：umuo 的所有功能都只需要文本，而「读取任意类型再原样恢复」
/// 是各平台差异最大、最容易写错的部分。降级取词会临时动剪贴板，
/// 所以在实现里要尽量少碰它。
pub trait Clipboard: Send + Sync {
    /// 读取当前文本内容；剪贴板里是图片/文件时返回 `None`。
    fn read_text(&self) -> Option<String>;

    fn write_text(&self, text: &str) -> Result<(), PlatformError>;
}
