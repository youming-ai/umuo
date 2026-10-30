//! umuo 客户端的应用层：内核（`umuo-core`）之上、界面之下的那一层。
//!
//! 放在这里的是与窗口系统无关的应用逻辑：设置的读写与校验、
//! 旧术语数据的配置转移、配置导入导出、每个窗口的请求登记、翻译流水线（`translate`）。
//! SwiftUI 客户端经 `umuo-ffi` 调用，同一份逻辑只写一次。
//!
//! 硬约束：**不依赖 Tauri、uniffi 或任何平台 API**，因此能在 Linux 上直接 `cargo test`。
//! 迁移的分步计划见 `docs/SWIFTUI-MIGRATION.md`。

pub mod config_io;
pub mod core;
pub mod event;
pub mod history;
pub mod host;
pub mod legacy_glossaries;
pub mod ops;
pub mod panel;
pub mod paths;
pub mod persist;
pub mod requests;
pub mod settings;
pub mod settings_patch;
pub mod translate;
pub mod voice;
pub mod voice_session;

pub use crate::core::AppCore;
pub use crate::host::Host;
