//! umuo-core / umuo-app 的 UniFFI 导出层，给 SwiftUI 客户端调用。
//!
//! 这一层只做「Rust 类型 ↔ FFI 友好类型」的转换：`&'static str` 变 `String`、
//! 内核结构体摊平成 Record。**不在这里写业务逻辑**——逻辑留在 umuo-core / umuo-app，
//! 那里有测试；这里写了，Swift 与 Rust 两边就各有一份会漂移的实现。
//!
//! 入口是 [`engine::Engine`]：打开配置目录、开始翻译（经 sink 推事件、经句柄取消）、读写设置。
//!
//! **线程约定**（Swift 端照此实现）：
//!
//! 1. sink 的 `on_event` 与 [`host::HostBridge`] 的方法都在 Rust 的 tokio 工作线程上**同步**调用。
//!    sink 里只把事件塞进 `AsyncStream`（保证增量按顺序到达；多个 `Task { @MainActor }` 不保证先后），
//!    宿主方法读加锁的缓存。
//! 2. Engine 的同步方法（设置、SQLite）从后台调用，不放在 MainActor 上。
//! 3. foreign trait 一律 `#[uniffi::export(foreign)]`：`callback_interface` 在 UniFFI 0.32 已废弃。

uniffi::setup_scaffolding!();

pub mod engine;
pub mod event;
pub mod host;
pub mod hotkey;
pub mod ops;
pub mod panel;
pub mod stub;
pub mod voice;
pub mod voice_session;

/// 按书写系统判断语言，返回 BCP-47 短码；判断不出时为空。
#[uniffi::export]
pub fn detect_language(text: String) -> Option<String> {
    umuo_core::lang::detect(&text).map(str::to_owned)
}

/// 选中的文本是否走单词词卡（≤3 个词）。
#[uniffi::export]
pub fn is_word_mode(text: String) -> bool {
    umuo_core::word_card::is_word_mode(&text)
}

/// 供应商目录里的一条，摊平成 Swift 能直接用的形状。
#[derive(uniffi::Record)]
pub struct ProviderInfo {
    pub id: String,
    pub label: String,
    pub default_model: String,
    pub needs_key: bool,
}

/// 全部内置供应商，顺序与内核目录一致（设置页按这个顺序列）。
#[uniffi::export]
pub fn provider_catalog() -> Vec<ProviderInfo> {
    umuo_core::provider::PROVIDERS
        .iter()
        .map(|provider| ProviderInfo {
            id: provider.id.to_owned(),
            label: provider.label.to_owned(),
            default_model: provider.default_model.to_owned(),
            needs_key: provider.requires_key(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_match_the_core() {
        assert_eq!(
            detect_language("你好世界".into()).as_deref(),
            umuo_core::lang::detect("你好世界")
        );
        assert!(is_word_mode("hello".into()));
        assert_eq!(
            provider_catalog().len(),
            umuo_core::provider::PROVIDERS.len()
        );
    }
}
