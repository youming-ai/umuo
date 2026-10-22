//! 平台能力边界。
//!
//! PRD §9 的架构要求是「凡是和操作系统打交道的能力都通过 trait 接口下沉到平台适配层」。
//! 这一层只有 trait 与错误类型，**没有任何平台依赖**——所以它能在任何平台上编译，
//! 而具体实现（[`umuo_platform_macos`]）在有平台的机器上编译。
//!
//! 为什么值得单独一个 crate：Windows（V1.1）与 Omarchy（V2）接入时，
//! 只需要新增一个实现，`umuo-core` 与应用层一行都不用改。把 trait 写在应用层里
//! 会让这个边界在第一次接新平台时就被打破。

pub mod capture;
pub mod clipboard;
pub mod error;
pub mod modifier;
pub mod ocr;
pub mod secret;
pub mod selection;
pub mod speech;

pub use capture::{CapturePermission, DisplayInfo, Region, ScreenCapture, ScreenImage};
pub use clipboard::Clipboard;
pub use error::PlatformError;
pub use modifier::{ModifierEvent, ModifierKind, ModifierMonitor, ModifierSide, PhysicalModifier};
pub use ocr::{Ocr, OcrLine, OcrResult};
pub use secret::SecretStore;
pub use selection::{FocusSource, FocusText, SelectionReader};
pub use speech::Speech;
