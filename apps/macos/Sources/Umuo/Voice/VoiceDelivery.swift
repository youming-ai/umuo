import AppKit
import ApplicationServices
import Carbon
import os
import UmuoCore

/// 把语音结果交付到录音开始时的输入框（阶段 E，PRD §5.11）。
///
/// 规则（何时交付、迟到 / 取消 / 截断不交付）在 Rust 的 `voice_session`；这里是宿主那一半：
/// 录音开始时记下目标，交付前现查核验，通过才写。复用原地翻译的守卫思路（`AXWriteBack`、`ReplaceSelection`），
/// 但比它们严：仅比较 pid 不足以证明还是原输入框（PRD §5.4），所以同时核对聚焦元素与窗口。
///
/// - 优先 AX：改 `AXSelectedText`，有选区就替换选区，没有就插在光标处，**不动已有文本**（不写 `AXValue`）。
/// - AX 问不出来（Electron 一类）时受控粘贴：快照剪贴板 → 写入 → ⌘V → 等一会儿 → 剪贴板没被别人动过才恢复。
/// - 任何模式都**不合成回车**，不替用户发送。
/// - 切应用、同应用换框、只读、安全输入、目标退出或无法核验：不写，浮层保留结果并说明原因。
@MainActor
protocol VoiceDelivering: AnyObject {
    /// 按键时记下来源应用与焦点控件，后台补齐选区和文本。
    func capture(session: UInt64)
    /// 核验录音开始时的目标并写入。nil = 写进去了；否则是拒绝原因（没有写任何东西）。
    func deliver(session: UInt64, text: String) async -> VoiceDeliveryRefusal?
    /// 放弃这一会话的交付：还没写的不再写。幂等。
    func cancel(session: UInt64)
}

/// 按键时同步取得的焦点身份，交给后台补齐上下文。
struct VoiceFocus: @unchecked Sendable {
    let pid: pid_t
    let element: AXUIElement
}

/// 录音开始时记下的目标。AX 元素只在核验时与当时的焦点做 `CFEqual`，不跨会话复用。
struct VoiceTarget: @unchecked Sendable {
    let pid: pid_t?
    let element: AXUIElement?
    let window: AXUIElement?
    var text: String? = nil
    var range: CFRange? = nil

    static let unavailable = VoiceTarget(pid: nil, element: nil, window: nil)

    /// 选区范围始终不可读时，以同一控件及未变的可读文本核验上下文。
    func matchesContext(text currentText: String?, range currentRange: CFRange?) -> Bool {
        text != nil && text == currentText && Self.sameRange(range, currentRange)
    }

    static func sameRange(_ original: CFRange?, _ current: CFRange?) -> Bool {
        switch (original, current) {
        case (nil, nil): true
        case let (original?, current?): original.location == current.location && original.length == current.length
        default: false
        }
    }
}

/// 交付前现查到的状态（全部是事实，判断在 `VoiceDeliveryRules.route`）。
struct VoiceDeliveryCheck: Equatable, Sendable {
    /// 有辅助功能权限。
    var trusted = true
    /// 录音开始时拿到了聚焦的输入对象。
    var captured = true
    /// 录音时的应用还在运行。
    var targetAlive = true
    /// 前台仍是录音时的应用。
    var sameApp = true
    /// 聚焦的仍是录音时那个元素、在同一个窗口里。
    var sameElement = true
    /// 安全输入：密码框，或有应用开启了安全键盘输入（`IsSecureEventInputEnabled`）。
    var secureInput = false
    /// `AXSelectedText` 是否可写；nil = 问不出来。
    var settable: Bool?
    /// 读得出选区（哪怕是空串）：读得出的文本控件，可写性回答才算数。
    var selectionReadable = true
    /// 聚焦元素的 AX 角色。
    var role: String?
}

/// 交付路线：AX 插入、受控粘贴，或拒绝。
enum VoiceDeliveryRoute: Equatable, Sendable {
    case accessibility
    case paste
    case refuse(VoiceDeliveryRefusal)
}

enum VoiceDeliveryRules {
    /// 读不出选区时，明显不是文本输入的角色：⌘V 在这些地方可能触发别的动作（访达里粘贴文件），不粘。
    static let nonTextRoles: Set<String> = [
        "AXList", "AXOutline", "AXTable", "AXBrowser", "AXGrid", "AXButton", "AXImage", "AXMenu", "AXMenuItem",
        "AXMenuBar", "AXCheckBox", "AXRadioButton", "AXSlider", "AXPopUpButton", "AXToolbar", "AXStaticText",
    ]

    /// 核验顺序：权限 → 目标 → 应用 → 焦点 → 安全输入 → 可写性。前面的不通过就不再看后面的。
    static func route(_ check: VoiceDeliveryCheck) -> VoiceDeliveryRoute {
        guard check.trusted else { return .refuse(.noPermission) }
        guard check.captured else { return .refuse(.unverifiable) }
        guard check.targetAlive else { return .refuse(.targetGone) }
        guard check.sameApp else { return .refuse(.appChanged) }
        guard check.sameElement else { return .refuse(.focusChanged) }
        guard !check.secureInput else { return .refuse(.secureInput) }
        if check.selectionReadable {
            // 读得出选区的文本控件：明确不可写就是只读（终端的滚动缓冲区也在这里拦下，不把文字打进 shell）
            switch check.settable {
            case true?: return .accessibility
            case false?: return .refuse(.notEditable)
            case nil: return .paste
            }
        }
        // 读不出选区（Electron / 网页视图里的 group）：可写性回答不算数，留给 ⌘V；明显不是文本输入的不粘
        if let role = check.role, nonTextRoles.contains(role) { return .refuse(.notEditable) }
        return .paste
    }
}

/// 交付要的系统能力（正式实现 `AXFocusProbe`，测试使用假对象）。除按键时读取焦点身份外，AX 查询和写入均在后台执行。
protocol VoiceFocusProbing: Sendable {
    /// 按键时取得的焦点身份。
    func captureFocus(pid: pid_t?) -> VoiceFocus?
    /// 只为按键时取得的控件补齐上下文，期间换了焦点就丢弃。
    func snapshot(_ focus: VoiceFocus) -> VoiceTarget
    /// 交付前现查。
    func check(_ target: VoiceTarget) -> VoiceDeliveryCheck
    /// 经 AX 把文本写进 `element` 的选区 / 光标处。返回是否成功。
    /// 写的是核验过的那个元素，不重新取焦点：核验与写入之间焦点换了框的话，写的仍是用户录音时对着的那个。
    func insert(_ text: String, into element: AXUIElement) -> Bool
    /// 前台应用（粘贴前最后核对一次）。
    func frontmostPid() -> pid_t?
}

/// 正式实现：Accessibility + `NSRunningApplication` + `AX.isSecureInput`。线程安全的 C API，后台直接调。
struct AXFocusProbe: VoiceFocusProbing {
    func captureFocus(pid: pid_t?) -> VoiceFocus? {
        guard let pid, AXIsProcessTrusted(), let element = Self.focusedElement(pid: pid) else { return nil }
        var elementPid: pid_t = 0
        guard AXUIElementGetPid(element, &elementPid) == .success, elementPid == pid else { return nil }
        return VoiceFocus(pid: pid, element: element)
    }

    /// 主线程只做一次有超时的 AX 焦点查询。后台核验也沿用同一应用的查询口径。
    private static func focusedElement(pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        guard AXUIElementSetMessagingTimeout(app, 0.1) == .success else { return nil }
        return AX.focusedElement(in: app)
    }

    func snapshot(_ focus: VoiceFocus) -> VoiceTarget {
        let element = focus.element
        guard AXUIElementSetMessagingTimeout(element, 0.25) == .success else { return .unavailable }
        defer { AXUIElementSetMessagingTimeout(element, 0) }
        guard !AX.isSecureInput(element) else { return .unavailable }
        let range = AX.selectedRange(element)
        let text = AX.string(element, kAXValueAttribute as CFString)
        let window = Self.window(element)
        guard VoiceTarget.sameRange(range, AX.selectedRange(element)),
              Self.focusedElement(pid: focus.pid).map({ CFEqual($0, element) }) == true else { return .unavailable }
        return VoiceTarget(pid: focus.pid, element: element, window: window, text: text, range: range)
    }

    func check(_ target: VoiceTarget) -> VoiceDeliveryCheck {
        var check = VoiceDeliveryCheck()
        check.trusted = AXIsProcessTrusted()
        guard check.trusted else { return check }
        guard let pid = target.pid, let captured = target.element else {
            check.captured = false
            return check
        }
        let app = NSRunningApplication(processIdentifier: pid)
        check.targetAlive = app.map { !$0.isTerminated } ?? false
        check.sameApp = frontmostPid() == pid && pid != ProcessInfo.processInfo.processIdentifier
        let current = AX.focusedElement()
        let sameWindow = Self.same(current.flatMap(Self.window), target.window)
        check.sameElement = (current.map { CFEqual($0, captured) } ?? false) && sameWindow
        guard let current else { return check }
        check.role = AX.string(current, kAXRoleAttribute as CFString)
        check.secureInput = AX.isSecureInput(current)
        if !check.secureInput {
            check.sameElement = check.sameElement && target.matchesContext(
                text: AX.string(current, kAXValueAttribute as CFString), range: AX.selectedRange(current)
            )
        }
        let name = kAXSelectedTextAttribute as CFString
        check.settable = AX.isSettable(current, name)
        check.selectionReadable = AX.string(current, name) != nil
        return check
    }

    func insert(_ text: String, into element: AXUIElement) -> Bool {
        AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFString) == .success
    }

    func frontmostPid() -> pid_t? { FrontmostApp.liveToken().flatMap { pid_t($0) } }

    private static func window(_ element: AXUIElement) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return nil }
        return (value as! AXUIElement)
    }

    /// 两个都问不出来窗口（部分应用）时不拿窗口否决；一边有一边没有算换了。
    private static func same(_ a: AXUIElement?, _ b: AXUIElement?) -> Bool {
        switch (a, b) {
        case (nil, nil): true
        case let (a?, b?): CFEqual(a, b)
        default: false
        }
    }
}

/// 正式的交付：录音开始时记目标，交付时后台核验并写入。
@MainActor
final class FocusedFieldDelivery: VoiceDelivering {
    private let probe: VoiceFocusProbing
    private let paster: ControlledPaste
    /// 只留当前会话的目标：新会话开始时旧的随之丢掉。
    private var targets: [UInt64: Task<VoiceTarget?, Never>] = [:]
    /// 在途交付持有自己的取消标记，结束后释放。
    private var deliveries: [UInt64: OSAllocatedUnfairLock<Bool>] = [:]

    init(probe: VoiceFocusProbing = AXFocusProbe(), paster: ControlledPaste = ControlledPaste()) {
        self.probe = probe
        self.paster = paster
    }

    func capture(session: UInt64) {
        for task in targets.values { task.cancel() }
        let probe = probe
        let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let focus = probe.captureFocus(pid: pid)
        // 截止时间从同步取焦点之后算：慢应用里那次查询本身最多 100 ms，算进去后台快照更容易超时、报「无法核验」
        let deadline = ContinuousClock.now + .milliseconds(250)
        targets = [session: Task.detached(priority: .userInitiated) {
            guard !Task.isCancelled, ContinuousClock.now < deadline else { return nil }
            guard let focus else { return .unavailable }
            let target = probe.snapshot(focus)
            guard !Task.isCancelled, ContinuousClock.now < deadline else { return nil }
            return target
        }]
    }

    func deliver(session: UInt64, text: String) async -> VoiceDeliveryRefusal? {
        guard let capture = targets.removeValue(forKey: session) else { return .unverifiable }
        let probe = probe, paster = paster
        let cancelled = OSAllocatedUnfairLock(initialState: false)
        deliveries[session] = cancelled
        defer { deliveries[session] = nil }
        guard let target = await capture.value else { return .unverifiable }
        return await Task.detached(priority: .userInitiated) {
            Self.perform(text, target: target, probe: probe, paster: paster) {
                cancelled.withLock { $0 }
            }
        }.value
    }

    func cancel(session: UInt64) {
        targets.removeValue(forKey: session)?.cancel()
        deliveries[session]?.withLock { $0 = true }
    }

    /// 核验 → 选路线 → 写。同步阻塞（AX 往返、剪贴板锁、等目标读剪贴板），只在后台调。
    nonisolated static func perform(_ text: String, target: VoiceTarget, probe: VoiceFocusProbing,
                                    paster: ControlledPaste, isCancelled: () -> Bool) -> VoiceDeliveryRefusal?
    {
        guard !isCancelled() else { return .failed }
        let route = VoiceDeliveryRules.route(probe.check(target))
        switch route {
        case let .refuse(reason):
            return reason
        case .accessibility:
            guard !isCancelled() else { return .failed }
            // 走到这里说明 check 已核验当前焦点就是录音开始时记下的元素：写它本身
            if let element = target.element, probe.insert(text, into: element) { return nil }
            // 元素声称可写却拒绝了：目标已核验过，退回受控粘贴
            return paste(text, target: target, probe: probe, paster: paster, isCancelled: isCancelled)
        case .paste:
            return paste(text, target: target, probe: probe, paster: paster, isCancelled: isCancelled)
        }
    }

    private nonisolated static func paste(_ text: String, target: VoiceTarget, probe: VoiceFocusProbing,
                                          paster: ControlledPaste, isCancelled: () -> Bool) -> VoiceDeliveryRefusal?
    {
        var lastCheck: VoiceDeliveryRefusal?
        let outcome = paster.run(text) {
            // ⌘V 发往前台：按下前再确认没被取消、前台仍是目标
            if isCancelled() {
                lastCheck = .failed
                return false
            }
            guard probe.frontmostPid() == target.pid else {
                lastCheck = .appChanged
                return false
            }
            // 等锁与快照可能耗时数秒：同一应用里换框、变只读或进入安全输入也要拒绝。
            if case let .refuse(reason) = VoiceDeliveryRules.route(probe.check(target)) {
                lastCheck = reason
                return false
            }
            if isCancelled() {
                lastCheck = .failed
                return false
            }
            return true
        }
        switch outcome {
        case .pasted: return nil
        case .skipped: return lastCheck ?? .failed
        // 没交付出去：结果照常留在浮层上可复制
        case .clipboardTooLarge, .clipboardChanged: return .failed
        case .failed: return .failed
        }
    }
}
