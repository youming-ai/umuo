import AppKit
import ApplicationServices

/// 浮窗「替换原文」：确认源应用恢复后检查目标可写性，再执行写入。
///
/// 与静默翻译的写回（`AXWriteBack`）不同：浮窗的原文可能本来就是靠模拟 ⌘C 取到的（Electron、网页视图），
/// AX 通道在那里不通，所以**有 ⌘V 兜底**；只有聚焦的确实是能读选区、又明确只读的文本控件（终端）才拒绝，
/// 免得 ⌘V 把译文打进 shell。
///
/// **同步阻塞、不要在主线程调**：AX 往返、剪贴板互斥锁（⌘C 降级的事务可能正拿着它，最长约 1 秒）、合成按键都在这里。
enum ReplaceSelection {
    /// 能不能往下走（含 ⌘V 兜底）：读得出选区的文本控件按选区的可写性判；读不出选区的元素
    /// （Electron / 网页视图里的 group、window）对任何属性都答「不可写」，那个回答不算数，留给 ⌘V。
    static func checkPanelWritable(settable: Bool?, selectionReadable: Bool) throws(AXWriteBack.Refused) {
        if selectionReadable { try AXWriteBack.checkWritable(.selection, settable) }
    }

    static func replace(_ text: String) throws(AXWriteBack.Refused) {
        guard AXIsProcessTrusted() else { throw AXWriteBack.Refused(detail: "需要系统权限：辅助功能") }
        let element = AX.focusedElement()
        let name = kAXSelectedTextAttribute as CFString
        try checkPanelWritable(settable: element.flatMap { AX.isSettable($0, name) },
                               selectionReadable: element.flatMap { AX.string($0, name) } != nil)

        // 首选仍是 AX：直接改写选区，不碰剪贴板。
        if let element, AXUIElementSetAttributeValue(element, name, text as CFString) == .success { return }

        try pasteFallback(text)
    }

    /// 兜底：写剪贴板 + ⌘V。只留给 AX 通道不通的 App（Electron 等）。
    ///
    /// 写入与粘贴在同一次 `Pasteboard.exclusive` 里做完：中间插进一次 ⌘C 取词降级的话，粘出去的是它清空或恢复后的内容。
    /// **不恢复剪贴板**：恢复了反而会让紧接着的粘贴拿到旧内容（目标应用处理 ⌘V 是异步的）。
    /// 剪贴板与按键可注入：selftest 换成私有剪贴板与假的粘贴，不碰用户剪贴板、不往别的应用里按键。
    static func pasteFallback(
        _ text: String,
        pasteboard: NSPasteboard = .general,
        paste: () throws(SelectionError) -> Void = { () throws(SelectionError) in try KeyEvent.paste() }
    ) throws(AXWriteBack.Refused) {
        Pasteboard.exclusive.lock()
        defer { Pasteboard.exclusive.unlock() }
        pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else {
            throw AXWriteBack.Refused(detail: "剪贴板不可用：写入失败")
        }
        do { try paste() } catch { throw AXWriteBack.Refused(detail: error.description) }
    }

    /// 把源应用切回前台（`ax::activate_pid`：设应用的 `AXFrontmost`）。AX 调用，工作线程上调。
    static func activate(pid token: String) -> Bool {
        guard let pid = pid_t(token), pid > 0 else { return false }
        let application = AXUIElementCreateApplication(pid)
        return AXUIElementSetAttributeValue(application, "AXFrontmost" as CFString, kCFBooleanTrue) == .success
    }

    /// 把源应用切回前台，并等到前台确实是它（最多约 600 ms）；回来后再多等一拍，让它把输入框的焦点与选区恢复好
    /// （Tauri 的 `refocus_source_app`）。浮窗「替换原文」与撰写窗 ⌘⇧↩ 共用。同步阻塞，工作线程上调。
    ///
    /// 不保证回得来：调用方必须在写入 / 粘贴前用 `FrontmostApp.liveToken()` 再核对一次。
    static func refocus(_ owner: String) {
        guard activate(pid: owner) else { return }
        for _ in 0 ..< 24 {
            Thread.sleep(forTimeInterval: 0.025)
            if FrontmostApp.liveToken() == owner {
                Thread.sleep(forTimeInterval: 0.05)
                return
            }
        }
    }
}
