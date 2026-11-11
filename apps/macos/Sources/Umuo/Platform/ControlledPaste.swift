import AppKit

/// 受控粘贴：借用户的剪贴板写一次 ⌘V，再原样还回去。
///
/// 语音交付、浮窗「替换原文」与撰写窗 ⌘⇧↩ 的 ⌘V 兜底共用这一套。
///
/// - 整个事务拿着 `Pasteboard.exclusive`，与 ⌘C 取词降级、复制互斥。
/// - 快照存全部 item 的全部类型（图片、文件、富文本都还得回去）；超出预算（`Pasteboard.Snapshot.Budget`）
///   就什么都不做、报 `clipboardTooLarge`，剪贴板原封不动。
/// - ⌘V 之后等 `restoreDelay`（目标应用读剪贴板是异步的），**剪贴板没被别人改过**才恢复；
///   期间用户（或别的应用）复制了新内容就不恢复，免得盖掉它。
/// - 拿到锁、取完快照后、**动剪贴板之前**最后问一次 `proceed`（没被取消、前台仍是目标）；不通过就什么都不做。
///   放在写剪贴板之前：`proceed` 可能要跟目标应用做几次 AX 往返，应用卡住时每次可达数秒，
///   这段时间里用户的剪贴板不能是译文。之后到 ⌘V 只隔一次写剪贴板。
///
/// 剪贴板与按键可注入：测试换成私有命名剪贴板与假的粘贴，不碰用户剪贴板、不往别的应用里按键。
struct ControlledPaste: @unchecked Sendable {
    var pasteboard: PasteboardAccess = NSPasteboard.general
    var paste: () throws(SelectionError) -> Void = { () throws(SelectionError) in try KeyEvent.paste() }
    /// ⌘V 之后等多久再恢复。宁长勿短，两边的代价不对称：
    /// - 太短：远程桌面、虚拟机、卡住的 Electron 应用晚于这个时间才读剪贴板，粘进去的是**用户原来的剪贴板**
    ///   （可能是刚从密码管理器复制的密码），而且这里会报 `restored: true`，谁也不知道。
    /// - 太长：译文在剪贴板上多留一会儿，调用方（语音浮层、替换提示）晚一点收到结果，期间别的剪贴板事务等锁。
    ///
    /// 没有办法确认「目标应用已经读过」：剪贴板管理器每次变化都会读，读过的信号说明不了什么。
    /// 原来是 0.35 秒，审查认为对慢应用太短。
    var restoreDelay: TimeInterval = 1.0
    /// 快照的上限（测试调小）。
    var snapshotBudget: Pasteboard.Snapshot.Budget = .standard

    enum Outcome: Equatable {
        /// 按了 ⌘V。`restored`：剪贴板已还原（false = 期间被别人改了，没有覆盖）。
        case pasted(restored: Bool)
        /// 最后一道检查没过，没按 ⌘V，剪贴板没动过。
        case skipped
        /// 写剪贴板或按键失败，已尽量还原。
        case failed(UserText)
        /// 剪贴板上的内容大到快照超出预算：什么都没做，剪贴板原封不动。
        /// 与 `failed` 分开：调用方不能再「把结果留在剪贴板上」，那会盖掉刚保住的内容。
        case clipboardTooLarge
    }

    func run(_ text: String, proceed: () -> Bool) -> Outcome {
        Pasteboard.exclusive.lock()
        defer { Pasteboard.exclusive.unlock() }
        guard let snapshot = Pasteboard.Snapshot.take(pasteboard, budget: snapshotBudget) else {
            return .clipboardTooLarge
        }
        guard proceed() else { return .skipped }
        pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else {
            snapshot.restore(pasteboard)
            return .failed(UserText("error.clipboardUnavailable"))
        }
        let ours = pasteboard.changeCount
        do {
            try paste()
        } catch {
            if pasteboard.changeCount == ours { snapshot.restore(pasteboard) }
            return .failed(error.text)
        }
        if restoreDelay > 0 { Thread.sleep(forTimeInterval: restoreDelay) }
        guard pasteboard.changeCount == ours else { return .pasted(restored: false) }
        snapshot.restore(pasteboard)
        return .pasted(restored: true)
    }
}
