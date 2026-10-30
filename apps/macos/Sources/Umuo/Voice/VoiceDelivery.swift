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
    /// 录音开始：记下这一会话的来源应用与焦点目标（后台现查，不阻塞主线程）。
    func capture(session: UInt64)
    /// 核验录音开始时的目标并写入。nil = 写进去了；否则是拒绝原因（没有写任何东西）。
    func deliver(session: UInt64, text: String) async -> VoiceDeliveryRefusal?
    /// 放弃这一会话的交付：还没写的不再写。幂等。
    func cancel(session: UInt64)
}

/// 录音开始时记下的目标。AX 元素只在核验时与当时的焦点做 `CFEqual`，不跨会话复用。
struct VoiceTarget: @unchecked Sendable {
    let pid: pid_t?
    let element: AXUIElement?
    let window: AXUIElement?
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

/// 交付要的系统能力（正式实现 `AXFocusProbe`，测试换成假的：不碰真实 AX、不按键）。都在后台线程调。
protocol VoiceFocusProbing: Sendable {
    /// 录音开始时的目标。
    func capture() -> VoiceTarget
    /// 交付前现查。
    func check(_ target: VoiceTarget) -> VoiceDeliveryCheck
    /// 经 AX 把文本写进当前焦点的选区 / 光标处。返回是否成功。
    func insert(_ text: String) -> Bool
    /// 前台应用（粘贴前最后核对一次）。
    func frontmostPid() -> pid_t?
}

/// 正式实现：Accessibility + `NSRunningApplication` + `IsSecureEventInputEnabled`。线程安全的 C API，后台直接调。
struct AXFocusProbe: VoiceFocusProbing {
    func capture() -> VoiceTarget {
        guard AXIsProcessTrusted() else { return VoiceTarget(pid: frontmostPid(), element: nil, window: nil) }
        let element = AX.focusedElement()
        var pid: pid_t = 0
        let elementPid = element.flatMap { AXUIElementGetPid($0, &pid) == .success && pid > 0 ? pid : nil }
        return VoiceTarget(pid: elementPid ?? frontmostPid(), element: element, window: element.flatMap(Self.window))
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
        check.sameElement = current.map { CFEqual($0, captured) } ?? false && sameWindow
        guard let current else { return check }
        let role = AX.string(current, kAXRoleAttribute as CFString)
        let subrole = AX.string(current, kAXSubroleAttribute as CFString)
        check.role = role
        check.secureInput = IsSecureEventInputEnabled() || role == "AXSecureTextField"
            || subrole == (kAXSecureTextFieldSubrole as String)
        let name = kAXSelectedTextAttribute as CFString
        check.settable = AX.isSettable(current, name)
        check.selectionReadable = AX.string(current, name) != nil
        return check
    }

    func insert(_ text: String) -> Bool {
        guard let element = AX.focusedElement() else { return false }
        return AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFString) == .success
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

/// 受控粘贴：借用户的剪贴板写一次 ⌘V，再原样还回去。
///
/// - 整个事务拿着 `Pasteboard.exclusive`，与 ⌘C 取词降级、浮窗替换互斥。
/// - 快照存全部 item 的全部类型（图片、文件、富文本都还得回去）。
/// - ⌘V 之后等 `restoreDelay`（目标应用读剪贴板是异步的），**剪贴板没被别人改过**才恢复；
///   期间用户（或别的应用）复制了新内容就不恢复，免得盖掉它。
/// - 按 ⌘V 前最后问一次 `proceed`（没被取消、前台仍是目标）；不通过就不按，立即恢复。
///
/// 剪贴板与按键可注入：测试换成私有命名剪贴板与假的粘贴，不碰用户剪贴板、不往别的应用里按键。
struct ControlledPaste: @unchecked Sendable {
    var pasteboard: NSPasteboard = .general
    var paste: () throws(SelectionError) -> Void = { () throws(SelectionError) in try KeyEvent.paste() }
    /// ⌘V 之后等多久再恢复。太短会让慢应用粘到旧内容，太长则用户剪贴板「消失」得久一点。
    var restoreDelay: TimeInterval = 0.35

    enum Outcome: Equatable {
        /// 按了 ⌘V。`restored`：剪贴板已还原（false = 期间被别人改了，没有覆盖）。
        case pasted(restored: Bool)
        /// 最后一道检查没过，没按 ⌘V，剪贴板已还原。
        case skipped
        /// 写剪贴板或按键失败，已尽量还原。
        case failed(String)
    }

    func run(_ text: String, proceed: () -> Bool) -> Outcome {
        Pasteboard.exclusive.lock()
        defer { Pasteboard.exclusive.unlock() }
        let snapshot = Pasteboard.Snapshot.take(pasteboard)
        pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else {
            snapshot.restore(pasteboard)
            return .failed("剪贴板不可用：写入失败")
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
            return .failed(error.description)
        }
        if restoreDelay > 0 { Thread.sleep(forTimeInterval: restoreDelay) }
        guard pasteboard.changeCount == ours else { return .pasted(restored: false) }
        snapshot.restore(pasteboard)
        return .pasted(restored: true)
    }
}

/// 正式的交付：录音开始时后台记目标，交付时后台核验并写入。
@MainActor
final class FocusedFieldDelivery: VoiceDelivering {
    private let probe: VoiceFocusProbing
    private let paster: ControlledPaste
    /// 只留当前会话的目标：新会话开始时旧的随之丢掉。
    private var targets: [UInt64: Task<VoiceTarget, Never>] = [:]
    /// 被取消的会话（后台写入前最后检查）。
    private let cancelled = OSAllocatedUnfairLock<Set<UInt64>>(initialState: [])

    init(probe: VoiceFocusProbing = AXFocusProbe(), paster: ControlledPaste = ControlledPaste()) {
        self.probe = probe
        self.paster = paster
    }

    func capture(session: UInt64) {
        let probe = probe
        targets = [session: Task.detached(priority: .userInitiated) { probe.capture() }]
        // 会话号单调递增：比新会话旧的取消记录不会再用到
        cancelled.withLock { $0 = $0.filter { $0 >= session } }
    }

    func deliver(session: UInt64, text: String) async -> VoiceDeliveryRefusal? {
        guard let pending = targets.removeValue(forKey: session) else { return .unverifiable }
        let target = await pending.value
        let probe = probe, paster = paster, cancelled = cancelled
        return await Task.detached(priority: .userInitiated) {
            Self.perform(text, target: target, probe: probe, paster: paster) {
                cancelled.withLock { $0.contains(session) }
            }
        }.value
    }

    func cancel(session: UInt64) {
        cancelled.withLock { _ = $0.insert(session) }
        targets[session]?.cancel()
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
            if probe.insert(text) { return nil }
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
            return true
        }
        switch outcome {
        case .pasted: return nil
        case .skipped: return lastCheck ?? .failed
        case .failed: return .failed
        }
    }
}
