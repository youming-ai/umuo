import AppKit
import ApplicationServices
import UmuoCore

/// 静默翻译读到的文本连同它的来源：读的是整个输入框，写回就必须替换整个输入框（PRD §5.4）。
/// 来源复用 FFI 的 `FocusSource`，直接交给 `Engine.translate`。
struct FocusText: Equatable {
    let text: String
    let source: FocusSource
    var writeTarget: String? = nil
    var owner: String? = nil
}

/// 取词失败。给用户看的话是文案键（`text`），由浮窗按界面语言取成句子。
enum SelectionError: UserFacingError, Equatable {
    /// 没有辅助功能权限。单独一个分支：UI 要据此把用户引到系统设置（PRD §7.4）。
    case permissionDenied
    case noSelection
    case blocked(String)
    /// 可写性检查拒绝（文案来自 `AXWriteBack.checkWritable`）。
    case notWritable(UserText)
    case other(UserText)

    var text: UserText {
        switch self {
        case .permissionDenied: UserText("error.accessibilityRequired")
        case .noSelection: UserText("error.noSelection")
        case let .blocked(message): UserText(message)
        case let .notWritable(text), let .other(text): text
        }
    }
}

/// 从前台应用取词。
///
/// **都是同步阻塞的，不要在主线程调**：⌘C 降级轮询最长约 1 秒，之前的快照另有预算。
/// AX 与 NSPasteboard 在工作线程上调都没问题。
enum Selection {
    /// 读取当前选中的文本：先走只读的 AX，拿不到（或只有空白）才降级到模拟 ⌘C。
    /// Electron / Java / 远程桌面里的 App 常常走降级。
    static func readSelection() throws(SelectionError) -> String { try readPanelSelection().text }

    static func readPanelSelection(
        blockNotice: (String) throws(SelectionError) -> String? = { _ in nil }
    ) throws(SelectionError) -> FocusText {
        guard AXIsProcessTrusted() else { throw .permissionDenied }
        let probe = AXTextProbe()
        let element = probe.focusedElement()
        let owner = try checkedOwner(of: element, blockNotice: blockNotice)
        if probe.secureInput(element) { throw .other(UserText("error.secureInput")) }
        let target = probe.targetToken(element, requiresRange: true)
        if let text = element.flatMap({ AX.string($0, kAXSelectedTextAttribute as CFString) }),
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            let confirmed = probe.focusStillMatches(target, requiresRange: true)
            return FocusText(text: text, source: .selection, writeTarget: confirmed ? target : nil, owner: owner)
        }
        // 无法证明选区身份时仍可翻译，但该结果没有写回目标。
        guard let pid = pid_t(owner) else { throw .other(UserText("error.targetChanged")) }
        let fallback = ClipboardFallback(copy: { () throws(SelectionError) in try KeyEvent.copy(to: pid) })
        let text = try fallback.read { () throws(SelectionError) in
            guard FrontmostApp.liveToken() == owner else { throw .other(UserText("error.targetChanged")) }
            if AX.isSecureInput(AX.focusedElement()) { throw .other(UserText("error.secureInput")) }
        }
        return FocusText(text: text, source: .selection, owner: owner)
    }

    /// 读取「该被翻译的文本」：优先选区，没有选区时读整个可编辑区域（PRD §5.4）。
    ///
    /// **不做剪贴板降级**：静默翻译紧接着要经同一条 AX 通道写回，这条通道不通的话，
    /// 降级取词也救不回来，只会白白动一次用户的剪贴板。
    static func readFocusText(
        blockNotice: (String) throws(SelectionError) -> String? = { _ in nil }
    ) throws(SelectionError) -> FocusText {
        guard AXIsProcessTrusted() else { throw .permissionDenied }
        let element = AX.focusedElement()
        let owner = try checkedOwner(of: element, blockNotice: blockNotice)
        // 密码框一个字都不读：读出来的可能是掩码，发给供应商之后还会被写回、覆盖密码。
        if AX.isSecureInput(element) { throw .other(UserText("error.secureInput")) }

        let probe = AXTextProbe()
        let target = probe.targetToken(element)

        // 选中了什么就翻什么。写不回去的话先说清楚，免得白翻一遍。
        if let text = element.flatMap({ AX.string($0, kAXSelectedTextAttribute as CFString) }),
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            try checkWritable(.selection, element)
            guard let target, probe.focusStillMatches(target, requiresRange: true) else {
                throw .other(UserText("error.targetChanged"))
            }
            return FocusText(text: text, source: .selection, writeTarget: target, owner: owner)
        }

        // 没选中就是「把整个输入框翻一遍」。**先确认整框可写再读**：终端的 AXValue 是整段滚动缓冲区，
        // 读了也写不回去，还会把它整段发给供应商。
        try checkWritable(.wholeField, element)
        guard let text = element.flatMap({ AX.string($0, kAXValueAttribute as CFString) }),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { throw .noSelection }
        guard let target, probe.focusStillMatches(target) else {
            throw .other(UserText("error.targetChanged"))
        }
        return FocusText(text: text, source: .wholeField, writeTarget: target, owner: owner)
    }

    /// 用即将读取的 AX 元素核对来源。没有元素时，复制降级只发给这次核准的进程。
    private static func checkedOwner(of element: AXUIElement?,
                                     blockNotice: (String) throws(SelectionError) -> String?) throws(SelectionError) -> String {
        guard let owner = FrontmostApp.liveToken() else { throw .other(UserText("error.targetChanged")) }
        if let element {
            var pid: pid_t = 0
            guard AXUIElementGetPid(element, &pid) == .success, String(pid) == owner else {
                throw .other(UserText("error.targetChanged"))
            }
        }
        if let message = try blockNotice(owner) { throw .blocked(message) }
        return owner
    }

    private static func checkWritable(_ source: FocusSource, _ element: AXUIElement?) throws(SelectionError) {
        let name = AXWriteBack.attribute(source) as CFString
        do { try AXWriteBack.checkWritable(source, element.flatMap { AX.isSettable($0, name) }) } catch {
            throw .notWritable(error.text)
        }
    }
}

/// 模拟 ⌘C 取词：与粘贴共用互斥锁，保存全部 item / 类型。
/// 事务期间若有新的键盘或鼠标操作，当前剪贴板可能属于用户，停止取词且不再恢复旧快照。
/// 系统不暴露剪贴板写入来源，不能把超时后的任意变化认成「迟到的 ⌘C」再覆盖；
/// 所以只在一次有界轮询内等结果，不在恢复之后继续写剪贴板。
struct ClipboardFallback {
    static let pollInterval: TimeInterval = 0.02
    /// 给慢应用最多约 1 秒；整个等待期间仍在同一次事务内。
    static let pollAttempts = 50

    var pasteboard: PasteboardAccess = NSPasteboard.general
    var copy: () throws(SelectionError) -> Void = { () throws(SelectionError) in try KeyEvent.copy() }
    var beginWatching: () -> ClipboardCopyWatching? = { ClipboardCopyGuard() }
    /// 轮询等待可注入：测试不依赖线程调度或真实用户输入。
    var wait: (TimeInterval) -> Void = { Thread.sleep(forTimeInterval: $0) }

    func read(validateSource: () throws(SelectionError) -> Void = {}) throws(SelectionError) -> String {
        Pasteboard.exclusive.lock()
        defer { Pasteboard.exclusive.unlock() }
        // 不能观察用户操作时不借用剪贴板；否则恢复旧快照可能覆盖用户的新复制。
        guard let watcher = beginWatching() else { throw .other(UserText("error.clipboardUnavailable")) }
        defer { watcher.stop() }
        let original = pasteboard.changeCount
        guard let snapshot = Pasteboard.Snapshot.take(pasteboard) else {
            throw .other(UserText(pasteboard.changeCount == original ? Pasteboard.tooLarge : Pasteboard.changed))
        }
        try validateSource()
        guard !watcher.wasInterrupted(), pasteboard.changeCount == original else {
            throw .other(UserText(Pasteboard.changed))
        }
        let cleared = pasteboard.clearContents()
        func interrupted() -> SelectionError {
            // 用户只是按了别的键、尚未复制时，空剪贴板仍是我们清空的，可以还原。
            if pasteboard.changeCount == cleared { snapshot.restore(pasteboard) }
            return .other(UserText(Pasteboard.changed))
        }
        do { try copy() } catch {
            // 按键失败并不代表剪贴板没变：只还原仍属于我们的空剪贴板。
            if pasteboard.changeCount == cleared { snapshot.restore(pasteboard) }
            throw error
        }

        var lastCount = cleared
        for _ in 0 ..< Self.pollAttempts {
            wait(Self.pollInterval)
            guard !watcher.wasInterrupted() else { throw interrupted() }
            let count = pasteboard.changeCount
            let text = Pasteboard.string(pasteboard)
            // 读取数据也可能触发延迟提供或 XPC，回来后要再核对操作与版本。
            // 用户插手由观察器判断；版本号在读取期间变了而没有用户操作，是源应用还在写
            // （先 clearContents 再写数据，第二步恰好落在读取时），读到的文本未必属于最新版本，下一轮重读。
            guard !watcher.wasInterrupted() else { throw interrupted() }
            guard pasteboard.changeCount == count else { continue }
            lastCount = count
            // 应用通常先 clearContents 再写数据：计数变了但文本尚未就位时继续等，
            // 不能在两步之间恢复快照、打断它正在写入的复制。
            if let text = Self.copiedText(cleared: cleared, now: count, text: text) {
                try validateSource()
                guard !watcher.wasInterrupted(), pasteboard.changeCount == count else { throw interrupted() }
                snapshot.restore(pasteboard)
                return text
            }
        }
        if watcher.wasInterrupted() { throw interrupted() }
        // 没有用户操作、且自上一轮起没再变：剪贴板仍是我们清空的，或源应用响应 ⌘C 只写了非文本（选中图片、图形）。
        // 两种都是我们这次复制造成的，与成功路径一样还原，不能把用户原来的内容换成那张图。
        if pasteboard.changeCount == lastCount { snapshot.restore(pasteboard) }
        throw .noSelection
    }

    static func copiedText(cleared: Int, now: Int, text: String?) -> String? {
        guard now != cleared, let text, !text.isEmpty else { return nil }
        return text
    }
}
