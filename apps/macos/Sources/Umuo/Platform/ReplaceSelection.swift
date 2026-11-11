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

    /// 读得出选区时，它必须还是翻译的那段原文：塌成光标、换了一段都不写（否则译文插在光标处或盖掉新选区）。
    /// 读不出（Electron / 网页视图，原文是 ⌘C 取到的）没有可比对的，照旧交给 ⌘V。
    /// 读得出却是空串的一律当作选区已变：分不清是塌成了光标，还是 AX 回空串、原文靠 ⌘C 取到的应用；宁可拒绝。
    static func checkSelectionUnchanged(current: String?, original: String) throws(AXWriteBack.Refused) {
        guard let current else { return }
        try AXWriteBack.checkUnchanged(.selection, current, original)
    }

    /// `original` 必须与取词时读到的逐字相同（浮窗的原文来自 Start 事件，Rust 原样回传请求里的文本）。
    /// AX、剪贴板、按键与前台查询可注入：测试换成假的，不碰真实系统。
    static func replace(_ text: String, original: String, owner: String,
                        probe: FocusedTextProbing = AXTextProbe(), paster: ControlledPaste = ControlledPaste(),
                        frontmost: () -> String? = FrontmostApp.liveToken) throws(AXWriteBack.Refused)
    {
        guard probe.trusted() else { throw AXWriteBack.Refused("error.accessibilityRequired") }
        let element = probe.focusedElement()
        // 取词后用户可能在同一应用里点进了密码框：前台 pid 守卫拦不住，密码框又读不出选区、
        // 会跳过「选区未变」直接走 ⌘V 兜底，把译文粘进密码框。
        if probe.secureInput(element) { throw AXWriteBack.Refused("error.secureInput") }
        let name = kAXSelectedTextAttribute
        let current = element.flatMap { probe.string($0, name) }
        try checkPanelWritable(settable: element.flatMap { probe.isSettable($0, name) },
                               selectionReadable: current != nil)
        try checkSelectionUnchanged(current: current, original: original)

        // 首选仍是 AX：直接改写选区，不碰剪贴板。
        if let element, probe.write(text, to: element, name) { return }

        try pasteFallback(text, owner: owner, paster: paster, frontmost: frontmost, validate: {
            finalCheck(element, original: original, probe: probe)
        })
    }

    /// 按 ⌘V 前的最后一道核对（拿着剪贴板锁、用户剪贴板还没动）：聚焦的还是开头查到的那个元素、
    /// 不是密码框、选区仍是原文。返回拒绝理由，nil = 放行。
    ///
    /// 开头就没查到聚焦元素（Electron、部分网页视图，原文靠 ⌘C 取到）：没有可比的身份，
    /// 只拦密码框 / 安全输入，前台应用由 `frontmost` 核对——与加身份守卫之前一样，⌘V 兜底照常可用。
    static func finalCheck(_ element: AXUIElement?, original: String, probe: FocusedTextProbing) -> UserText? {
        let current = probe.focusedElement()
        if probe.secureInput(current) { return UserText("error.secureInput") }
        guard let element else { return nil }
        guard let current, CFEqual(element, current) else { return UserText("error.targetChanged") }
        do {
            try checkSelectionUnchanged(current: probe.string(current, kAXSelectedTextAttribute), original: original)
        } catch { return error.text }
        return nil
    }

    /// 兜底：受控粘贴（`ControlledPaste`，与语音交付同一套）。只留给 AX 通道不通的 App（Electron 等）。
    ///
    /// 快照用户剪贴板 → 写译文 → ⌘V → 等目标应用读完 → 剪贴板没被别人动过才恢复；整个事务拿着 `Pasteboard.exclusive`，
    /// 中间插不进 ⌘C 取词降级。剪贴板与按键可注入：测试换成私有剪贴板与假的粘贴。
    static func pasteFallback(_ text: String, owner: String, paster: ControlledPaste = ControlledPaste(),
                              frontmost: () -> String? = FrontmostApp.liveToken,
                              validate: () -> UserText? = { nil }) throws(AXWriteBack.Refused)
    {
        // 等剪贴板锁（最长约 1 秒）期间用户可能切走了：⌘V 发往前台，按下前最后核对一次。
        // 没过的理由如实上报（进了密码框、选区变了），不笼统说「目标已切换」。
        var refusal = UserText("error.targetChanged")
        let outcome = paster.run(text, proceed: {
            guard frontmost() == owner else { return false }
            if let reason = validate() {
                refusal = reason
                return false
            }
            return true
        })
        switch outcome {
        case .pasted: return
        case .skipped: throw AXWriteBack.Refused(refusal)
        case .clipboardTooLarge: throw AXWriteBack.Refused(Pasteboard.tooLarge)
        case .clipboardChanged: throw AXWriteBack.Refused(Pasteboard.changed)
        case let .failed(text): throw AXWriteBack.Refused(text)
        }
    }

    /// 把源应用切回前台（设应用的 `AXFrontmost`）。AX 调用，工作线程上调。
    static func activate(pid token: String) -> Bool {
        guard let pid = pid_t(token), pid > 0 else { return false }
        let application = AXUIElementCreateApplication(pid)
        return AXUIElementSetAttributeValue(application, "AXFrontmost" as CFString, kCFBooleanTrue) == .success
    }

    /// 把源应用切回前台，并等到前台确实是它（最多约 600 ms）；回来后再多等一拍，让它把输入框的焦点与选区恢复好
    /// 浮窗「替换原文」与撰写窗 ⌘⇧↩ 共用。同步阻塞，工作线程上调。
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
