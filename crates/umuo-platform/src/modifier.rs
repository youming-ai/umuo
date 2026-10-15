//! 监听修饰键的按下与松开（给「连按两下 ⌃」这类快捷键用）。
//!
//! 只报**物理键**与按下 / 松开，不做任何判定——「是不是连按了两下」是内核的纯逻辑
//! （`umuo_core::hotkey`），平台层只负责把系统事件翻译成这几种。

use crate::PlatformError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModifierKind {
    Ctrl,
    Alt,
    Shift,
    Cmd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModifierSide {
    Left,
    Right,
}

/// 一个物理修饰键（例如「右 ⌘」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhysicalModifier {
    pub kind: ModifierKind,
    pub side: ModifierSide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModifierEvent {
    Down(PhysicalModifier),
    Up(PhysicalModifier),
    /// 按了别的键、或点了鼠标——打断正在进行的连按。
    Other,
}

/// 修饰键监听。
pub trait ModifierMonitor: Send + Sync {
    /// 开始监听，之后每个事件都回调 `on_event`（在监听线程上，回调要快）。
    ///
    /// 失败通常是缺权限；**失败后可以再次调用**（用户授权之后重试）。成功后不应再调用。
    fn start(
        &self,
        on_event: Box<dyn Fn(ModifierEvent) + Send + 'static>,
    ) -> Result<(), PlatformError>;
}
