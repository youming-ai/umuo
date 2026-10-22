//! macOS 平台适配。
//!
//! 三块能力，各自的实现代价差别很大：
//!
//! | 能力 | 办法 | 代价 |
//! | --- | --- | --- |
//! | 取词 | Accessibility API 优先，失败降级为模拟 ⌘C | 中（要手写 FFI） |
//! | 剪贴板 | `arboard`（纯文本）+ NSPasteboard（取词降级的完整快照） | 低 |
//! | 凭据存储 | `keyring`（Keychain 后端） | 低 |
//!
//! ## 为什么取词要优先走 Accessibility
//!
//! 降级路径（模拟 ⌘C）会**改写用户的剪贴板**。虽然我们在读完内容后会把它恢复回去，
//! 但「为了翻译一句话而动了剪贴板」本身就是副作用：用户可能下一秒就要粘贴别的东西。
//! Accessibility 是只读的、非破坏性的，所以它必须是首选路径，
//! 剪贴板只在前者拿不到内容时兜底。
//!
//! ## 已知边界（诚实记录）
//!
//! - 降级路径存下剪贴板上所有 item 的所有类型并原样恢复，用 changeCount 判断复制是否生效、
//!   超时后迟到的复制是否又盖了上来。仍恢复不了的：只以「延迟提供」形式挂在剪贴板上、
//!   读取时已经取不到数据的类型（例如源应用已退出的文件承诺）。
//! - Electron / Java / 远程桌面里的部分 App 不暴露 Accessibility 选区，
//!   会走降级路径（PRD §12.1 已把它列为风险）。

#![cfg(target_os = "macos")]

pub mod ax;
pub mod capture;
pub mod clipboard;
pub mod key_event;
pub mod modifier_tap;
pub mod ocr;
pub mod secret;
pub mod selection;
pub mod speech;

pub use capture::MacScreenCapture;
pub use clipboard::MacClipboard;
pub use modifier_tap::MacModifierMonitor;
pub use ocr::MacOcr;
pub use secret::MacSecretStore;
pub use selection::MacSelection;
pub use speech::MacSpeech;

/// Keychain 里的服务名。换它等于让所有用户重新填一次 Key。
pub const KEYCHAIN_SERVICE: &str = "app.umuo.desktop";
