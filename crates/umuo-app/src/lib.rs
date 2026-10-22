//! umuo 客户端的应用层：内核（`umuo-core`）之上、界面之下的那一层。
//!
//! 放在这里的是**两个客户端都要用、又和窗口系统无关**的东西：设置的读写与校验、
//! 术语表与统计文件、配置导入导出、每个窗口的请求登记、翻译流水线（`translate`）与多模型对比（`compare`）。Tauri 外壳现在用它，
//! SwiftUI 客户端以后经 `umuo-ffi` 用它——同一份逻辑只写一次，迁移时不重写也不漂移。
//!
//! 硬约束：**不依赖 Tauri、uniffi 或任何平台 API**，因此能在 Linux 上直接 `cargo test`。
//! 迁移的分步计划见 `docs/SWIFTUI-MIGRATION.md`。

pub mod budget;
pub mod compare;
pub mod config_io;
pub mod core;
pub mod event;
pub mod glossaries;
pub mod history;
pub mod host;
pub mod ops;
pub mod panel;
pub mod paths;
pub mod persist;
pub mod requests;
pub mod settings;
pub mod settings_patch;
pub mod stats;
pub mod translate;

pub use crate::core::AppCore;
pub use crate::host::Host;
