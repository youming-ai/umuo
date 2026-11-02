//! umuo 客户端的应用层：内核（`umuo-core`）之上、界面之下的那一层。
//!
//! 放在这里的是与窗口系统无关的应用逻辑：设置的读写与校验（`settings`、`settings_patch`）、
//! 配置导入导出与旧术语数据的转移（`config_io`、`legacy_glossaries`）、历史（`history`）、
//! 每个窗口的请求登记（`requests`）、翻译流水线（`translate`）、语音后处理与会话（`voice`、`voice_session`）、
//! 浮窗规则（`panel`）与界面命令（`ops`）。SwiftUI 客户端经 `umuo-ffi` 调用，同一份逻辑只写一次。
//!
//! 硬约束：**不依赖 uniffi 或任何平台 API**，平台能力只经 [`Host`] 向 Swift 宿主要，
//! 因此能在 Linux 上直接 `cargo test`。

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
