//! macOS 平台适配。
//!
//! 三块能力，各自的实现代价差别很大：
//!
//! | 能力 | 办法 | 代价 |
//! | --- | --- | --- |
//! | 取词 | Accessibility API 优先，失败降级为模拟 ⌘C | 中（要手写 FFI） |
//! | 剪贴板 | `arboard` | 低 |
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
//! - 降级路径只能恢复**文本**。若剪贴板里原本是图片或文件，恢复不了——
//!   Accessibility 路径不受影响。完整快照（全类型 + changeCount 双重校验）
//!   列为后续项，参考实现见 `docs/research/luca-translate-audit.md`。
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
