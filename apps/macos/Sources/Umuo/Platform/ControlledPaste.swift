import AppKit

/// 受控粘贴：借用户的剪贴板写一次 ⌘V，再原样还回去。
///
/// 语音交付、浮窗「替换原文」与撰写窗 ⌘⇧↩ 的 ⌘V 兜底共用这一套。
///
/// - 整个事务拿着 `Pasteboard.exclusive`，与 ⌘C 取词降级、复制互斥。
/// - 快照存全部 item 的全部类型（图片、文件、富文本都还得回去）。
/// - ⌘V 之后等 `restoreDelay`（目标应用读剪贴板是异步的），**剪贴板没被别人改过**才恢复；
///   期间用户（或别的应用）复制了新内容就不恢复，免得盖掉它。
/// - 按 ⌘V 前最后问一次 `proceed`（没被取消、前台仍是目标）；不通过就不按，立即恢复。
///
/// 剪贴板与按键可注入：测试换成私有命名剪贴板与假的粘贴，不碰用户剪贴板、不往别的应用里按键。
struct ControlledPaste: @unchecked Sendable {
    var pasteboard: PasteboardAccess = NSPasteboard.general
    var paste: () throws(SelectionError) -> Void = { () throws(SelectionError) in try KeyEvent.paste() }
    /// ⌘V 之后等多久再恢复。太短会让慢应用粘到旧内容，太长则用户剪贴板「消失」得久一点。
    var restoreDelay: TimeInterval = 0.35

    enum Outcome: Equatable {
        /// 按了 ⌘V。`restored`：剪贴板已还原（false = 期间被别人改了，没有覆盖）。
        case pasted(restored: Bool)
        /// 最后一道检查没过，没按 ⌘V，剪贴板已还原。
        case skipped
        /// 写剪贴板或按键失败，已尽量还原。
        case failed(UserText)
    }

    func run(_ text: String, proceed: () -> Bool) -> Outcome {
        Pasteboard.exclusive.lock()
        defer { Pasteboard.exclusive.unlock() }
        let snapshot = Pasteboard.Snapshot.take(pasteboard)
        pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else {
            snapshot.restore(pasteboard)
            return .failed(UserText("error.clipboardUnavailable"))
        }
        let ours = pasteboard.changeCount
        guard proceed() else {
            snapshot.restore(pasteboard)
            return .skipped
        }
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
