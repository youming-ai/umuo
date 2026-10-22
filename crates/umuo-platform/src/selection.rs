//! 取词与写回。

use crate::error::PlatformError;

/// 静默翻译读到的文本来自哪里，决定写回时替换什么（PRD §5.4）。
///
/// 读和写必须对得上：读的是整个输入框，写回就必须替换整个输入框；
/// 只拿一个 `String` 往下传的话，写回只能按「替换选区」处理——选区为空时
/// 等于在光标处插入，原文和译文就叠在一起了。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusSource {
    /// 用户选中了一段文字：写回替换这段选区。
    Selection,
    /// 没有选区，读的是整个可编辑区域：写回替换整个区域。
    WholeField,
}

/// [`SelectionReader::read_focus_text`] 的结果：文本连同它的来源。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusText {
    pub text: String,
    pub source: FocusSource,
}

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
    ///
    /// 走整框时，实现应先确认这个区域**可写**再读：不可写的元素（例如终端的
    /// 滚动缓冲区）既写不回去，也不该被整段读走发给供应商。
    fn read_focus_text(&self) -> Result<FocusText, PlatformError>;

    /// 静默翻译的写回：按读取时的来源替换选区或整个区域（PRD §5.4）。
    ///
    /// `original` 是当初读到的原文。整框写回前实现应确认区域内容没变——
    /// 翻译要几秒，用户可能又打了字，覆盖掉就丢了他的输入。
    ///
    /// **不做粘贴兜底**：写不进去就返回错误。合成 ⌘V 只会在光标处插入，
    /// 在终端这类不可写的地方还会把译文直接打进 shell。
    fn replace_focus_text(
        &self,
        source: FocusSource,
        original: &str,
        text: &str,
    ) -> Result<(), PlatformError>;

    /// 用 `text` 替换当前选中内容（浮窗的「替换原文」，PRD §5.2）。
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

    /// 把标识为 `token`（[`Self::frontmost_app_token`] 返回的值）的应用切回前台。
    ///
    /// 浮窗「替换原文」用：点浮窗会激活本应用，写回前要先把焦点还给源应用。
    /// 返回 true 只表示请求被接受；焦点是否真的回来，调用方要再查一次前台标识。
    fn activate_app(&self, token: &str) -> bool;

    /// 当前前台应用的**显示名**，用于历史记录里的「来源 App」。
    ///
    /// 拿不到时返回 `None`。**不要用 pid 之类的占位符顶替**——
    /// 历史里出现一个 `4711` 只会让人以为工具坏了。
    fn frontmost_app_name(&self) -> Option<String>;

    /// 当前是否已经拿到所需权限。UI 用它决定要不要显示引导（PRD §7.4）。
    fn is_trusted(&self) -> bool;
}
