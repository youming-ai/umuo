//! 取词与写回。

use crate::error::PlatformError;

/// 从系统前台应用读写文本。
///
/// 两个方法合在一个 trait 里，是因为它们共享同一组前置条件（辅助功能权限、
/// 目标 App 是否可写）——拆开后每个实现都要重复一遍权限判断。
pub trait SelectionReader: Send + Sync {
    /// 读取当前选中的文本。
    ///
    /// 实现约定：优先走**非破坏性**的系统接口（macOS 上是 Accessibility），
    /// 只有它失败时才降级到模拟复制。降级路径会动用户的剪贴板，
    /// 所以不能作为首选路径。
    fn read_selection(&self) -> Result<String, PlatformError>;

    /// 读取「该被翻译的文本」：优先选区，没有选区时读整个可编辑区域（PRD §5.4）。
    ///
    /// 与 [`read_selection`](Self::read_selection) 的区别不只是「兜底读整个输入框」：
    /// 它**不做剪贴板降级**。静默翻译紧接着要把结果写回去，而写回走的是同一条
    /// 可访问性通道；这条通道不通的话，降级取词也救不回来，只会白白动一次
    /// 用户的剪贴板。所以拿不到就直接说拿不到。
    fn read_focus_text(&self) -> Result<String, PlatformError>;

    /// 用 `text` 替换当前选中内容（PRD §5.4 输入框原地替换）。
    fn replace_selection(&self, text: &str) -> Result<(), PlatformError>;

    /// 向当前前台应用发送一次「粘贴」（macOS 上是合成 ⌘V）。
    ///
    /// 撰写窗的 ⌘⇧Enter 用它：先把译文写进剪贴板、收起我们自己的窗口，
    /// 再让焦点回到上一个 App 并粘贴（PRD §5.3）。
    /// 调用方负责先写剪贴板——这个动作只负责按键。
    fn paste_clipboard(&self) -> Result<(), PlatformError>;

    /// 当前前台应用的标识，用于「翻译完再写回」时确认目标没变。
    ///
    /// 翻译要花几秒，用户完全可能在这期间切到别的窗口。没有这个守卫的话，
    /// 译文会被打进另一个应用的输入框里——这是本产品能造成的最糟糕的破坏。
    /// 同一个焦点连续两次调用应返回相同的值；实现不了时返回 `None`。
    fn frontmost_app_token(&self) -> Option<String>;

    /// 当前前台应用的**显示名**，用于历史记录里的「来源 App」。
    ///
    /// 拿不到时返回 `None`。**不要用 pid 之类的占位符顶替**——
    /// 历史里出现一个 `4711` 只会让人以为工具坏了。
    fn frontmost_app_name(&self) -> Option<String>;

    /// 当前是否已经拿到所需权限。UI 用它决定要不要显示引导（PRD §7.4）。
    fn is_trusted(&self) -> bool;
}
