//! 应用层要向宿主（Tauri 外壳、以后的 SwiftUI 客户端）要的东西。
//!
//! 原则：能提前取的值由宿主先取好再传进来，流水线中途必须现取的才走这里。

/// 静默翻译的原文读自哪里——写回时据此替换同样的范围（PRD §5.4）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusSource {
    /// 输入框里有选区：只替换选区。
    Selection,
    /// 没有选区：读的是整个输入框，写回也替换整个输入框。
    WholeField,
}

/// 宿主提供的平台能力。两个客户端各实现一份：Tauri 用 `umuo-platform-macos`，Swift 直接调 Apple API。
pub trait Host: Send + Sync {
    /// 某个供应商的 API Key（Keychain：service `app.umuo.desktop`，account = 供应商 id）。
    /// 预算检查要看其它供应商有没有配 Key，所以不能由宿主一次性预取。
    fn api_key(&self, provider_id: &str) -> Result<Option<String>, String>;

    /// 当前前台应用的显示名，记在历史里作「来源应用」。要便宜：每条历史调一次。
    fn frontmost_app_name(&self) -> Option<String>;

    /// 当前前台应用的标识（macOS 上是 pid）。写回守卫拿它与取词时记下的比对。
    fn frontmost_app_token(&self) -> Option<String>;

    /// 静默翻译的写回：按读取时的来源替换选区或整个输入框。
    /// 只在翻译成功、且守卫放行之后调用一次；没有 ⌘V 兜底，写不进去就如实报告。
    fn write_back(&self, source: FocusSource, original: &str, text: &str) -> Result<(), String>;
}
