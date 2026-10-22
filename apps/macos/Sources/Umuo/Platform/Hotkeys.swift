import Foundation
import os
import UmuoCore

/// 七个快捷键对应的功能。处理函数在阶段 3 随窗口接上（`HotkeyCenter.perform`）。
enum HotkeyAction: String, CaseIterable, Sendable {
    case selection, silentReplace, compose, compare, ocr, ocrSilent, speak
}

/// 全局快捷键的注册、重注册、暂停与录键，对应 Tauri 外壳 `main.rs` 的 `register_hotkeys` /
/// `reregister_hotkeys` / `hotkeys_suspended` 与 `commands.rs` 的 `set_hotkey_recording`，连按部分对应 `double_tap.rs`。
///
/// 每条设置先经 Rust 的 `parseHotkey` 分流：连按两下修饰键（⌃⌃）**必须先分流出去**——交给组合键解析
/// 会失败、然后悄悄回落到默认组合键，用户设了 ⌃⌃，实际生效的却是 ⌥D。
@MainActor
final class HotkeyCenter {
    /// 一行快捷键配置：设置字段名（`settings.json` 的 camelCase 键，也是失败清单里记的名字）、
    /// 解析失败时回落的组合键、要触发的功能。回落只用于「既不是连按、又解析不了」的值；
    /// 连按监听起不来时不回落，而是标成失败。连按默认的两行写旧版默认 ⌥D / ⌥⇧T 占位。
    nonisolated static let table: [(field: String, fallback: String, action: HotkeyAction)] = [
        ("selectionHotkey", "Alt+D", .selection),
        ("silentReplaceHotkey", "Alt+Shift+T", .silentReplace),
        ("composeHotkey", "Alt+Cmd+A", .compose),
        ("compareHotkey", "Alt+P", .compare),
        ("ocrHotkey", "Alt+Cmd+O", .ocr),
        ("ocrSilentHotkey", "Alt+Shift+O", .ocrSilent),
        ("speakHotkey", "Alt+R", .speak),
    ]

    /// 录快捷键最长持续多久。超过就当作被放弃，自动恢复全局快捷键。
    nonisolated static let recordingLimit: TimeInterval = 30

    /// 一行解析之后要做什么。
    enum Plan: Equatable {
        case combo(HotkeyCombo.Parsed)
        case doubleTap(DoubleTap)
    }

    /// 设置 → 每行的计划。纯函数：选回落、分流连按都在这里，selftest 不用真的注册就能验。
    nonisolated static func plan(_ values: [String: String]) -> [(field: String, plan: Plan, action: HotkeyAction)] {
        table.map { row in
            let plan: Plan = switch parseHotkey(value: values[row.field] ?? "") {
            case let .doubleTap(tap): .doubleTap(tap)
            case let .combo(value):
                // 默认值都是合法组合键，回落一定解析得出来
                .combo(HotkeyCombo.parse(value) ?? HotkeyCombo.parse(row.fallback)!)
            }
            return (row.field, plan, row.action)
        }
    }

    /// 从 `Engine.settingsJson()` 里只取七个快捷键字段（不用 Codable 解整份设置，见迁移文档「必须守住的兼容性」）。
    nonisolated static func values(settingsJson: String) -> [String: String] {
        let object = (try? JSONSerialization.jsonObject(with: Data(settingsJson.utf8))) as? [String: Any] ?? [:]
        return table.reduce(into: [:]) { values, row in values[row.field] = object[row.field] as? String }
    }

    private let perform: @MainActor (HotkeyAction) -> Void
    private let combos = GlobalHotkeys()
    private let doubleTaps = DoubleTapRouter()
    /// 最近一次生效的设置，录键结束或超时后按它重注册。
    private var values: [String: String] = [:]

    /// 注册失败的设置字段名（界面按它把失败标在对应那一行上）。
    private(set) var failures: [String] = []
    /// 用户点了「暂停」。
    var paused = false
    /// 录键截止时刻（单调时钟秒，同 Rust 的 Instant，不受改系统时间影响）。
    private var recordingUntil: TimeInterval?
    /// 重注册完成（失败清单可以读了）、或补启动连按监听之后调用，对应 Tauri 的 `hotkeys://registered` 事件。
    var onRegistered: (@MainActor () -> Void)?

    init(perform: @escaping @MainActor (HotkeyAction) -> Void) {
        self.perform = perform
    }

    /// 已注册的组合键个数（selftest 用）。
    var registeredCombos: Int { combos.count }
    var doubleTapListening: Bool { doubleTaps.started }

    /// 全局快捷键此刻是否应当不响应：用户点了「暂停」，或设置窗正在录快捷键。
    /// 组合键与连按两下共用这一个判断，加新的快捷键类型时不必记得再判断一遍。
    var suspended: Bool {
        paused || recordingUntil.map { Self.now() < $0 } ?? false
    }

    /// 清掉全部旧注册、按新设置重注册，**不用重启**。只在快捷键真的变了时调（`SettingsUpdate.hotkeysChanged`）：
    /// 每拨一个开关都重注册一遍会白白清空又重建失败记录。
    func reregister(_ values: [String: String]) {
        for status in combos.unregisterAll() {
            print("umuo: 清除旧快捷键失败：OSStatus \(status)")
        }
        register(values)
        // 通知设置窗：重注册已完成，可以读新的失败清单了（比猜一个延时可靠）。
        onRegistered?()
    }

    /// 注册全局快捷键。注册失败**不让启动失败**：一个被别的 App 占用的组合键不该把整个客户端拖垮（PRD §12.1）。
    /// 失败记进 `failures`，而不只是打日志（PRD §7.2 的冲突提示）。
    func register(_ values: [String: String]) {
        self.values = values
        // 每次注册前清空：旧的失败记录已经过期。
        failures = []
        var taps: [DoubleTapRouter.Binding] = []
        for row in Self.plan(values) {
            switch row.plan {
            case let .doubleTap(tap):
                taps.append(.init(tap: tap, field: row.field, action: row.action))
            case let .combo(parsed):
                let action = row.action
                do {
                    try combos.register(parsed) { [weak self] in
                        // 暂停与录键检查放在**这一处**而不是七个处理函数里
                        guard let self, !self.suspended else { return }
                        self.perform(action)
                    }
                } catch {
                    print("umuo: \(row.field) 快捷键注册失败（可能已被其它应用占用）：\(error)")
                    failures.append(row.field)
                }
            }
        }
        do {
            try doubleTaps.set(taps, dispatch: dispatcher())
        } catch {
            print("umuo: 连按快捷键不可用：\(error)")
            failures += taps.map(\.field)
        }
    }

    /// 注销全部组合键（退出、或 selftest 收尾）。连按绑定一并清空，监听线程留着但不再触发任何功能。
    func unregisterAll() {
        combos.unregisterAll()
        doubleTaps.replaceBindings([])
    }

    /// 之前因缺权限没启动起来、现在用户授了权：补启动监听，并把连按那几行的失败标记清掉。
    ///
    /// 新装用户的默认划词键就是 ⌃⌃——启动时多半还没授权，监听起不来；授完权不补这一下，
    /// 就得改一次快捷键或重启客户端才能用。由「检查辅助功能权限」的入口在授权后调用。
    func retryStart() {
        let fields = doubleTaps.fields
        guard !fields.isEmpty, !doubleTaps.started else { return }
        guard (try? doubleTaps.start(dispatch: dispatcher())) != nil else { return }
        failures.removeAll { fields.contains($0) }
        onRegistered?()
    }

    /// 设置窗开始 / 结束「录快捷键」。
    ///
    /// 开始时**注销全部组合键**：系统会把已注册的组合键直接截走，录键器收不到——不注销的话，
    /// 想重录当前这个键（或任何已占用的键）时什么也录不到。连按不注销，靠 `suspended` 挡住。
    /// 结束时按当前设置重新注册。录到一半窗口被关掉、来不及说「结束」，由定时器在截止后自动恢复。
    func setRecording(_ active: Bool) {
        let wasRecording = recordingUntil != nil
        recordingUntil = active ? Self.now() + Self.recordingLimit : nil
        if active {
            for status in combos.unregisterAll() {
                // 注销失败时，已占用的组合仍会被系统截走、录键器收不到——至少留下记录便于排查。
                print("umuo: 录快捷键前注销全局快捷键失败：OSStatus \(status)")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.recordingLimit + 0.2) { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, let until = self.recordingUntil, Self.now() >= until else { return }
                    self.recordingUntil = nil
                    self.reregister(self.values)
                }
            }
        } else if wasRecording {
            reregister(values)
        }
    }

    private nonisolated static func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }

    /// 监听线程凑成连按之后：回主线程，不在暂停或录键时才执行。
    private func dispatcher() -> @Sendable (HotkeyAction) -> Void {
        { [weak self] action in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, !self.suspended else { return }
                    self.perform(action)
                }
            }
        }
    }
}

/// 连按两下修饰键的接线，对应 Tauri 外壳的 `double_tap.rs`：
/// `ModifierTap` 报修饰键的按下 / 松开 → Rust 的 `DoubleTapDetector` 判定连按 → 找绑定、回主线程执行。
///
/// 监听只在**真的有连按快捷键**时才启动：全用普通组合键的用户不需要多开一个键盘监听（也不用授「输入监控」）。
final class DoubleTapRouter: @unchecked Sendable {
    struct Binding: Sendable {
        let tap: DoubleTap
        /// 设置字段名（启动失败时按它标到设置页对应那一行）。
        let field: String
        let action: HotkeyAction
    }

    /// 当前生效的绑定。改快捷键时整体替换；监听本身不重建。监听线程上读，所以加锁。
    private let bindings = OSAllocatedUnfairLock<[Binding]>(initialState: [])
    /// 监听是否已经启动成功。**只记成功**：缺权限导致的失败要允许在用户授权后重试——
    /// 把失败也缓存住的话，授完权再改快捷键也启用不了，只能重启客户端。只在主线程上读写。
    private(set) var started = false
    private let detector = DoubleTapDetector()

    var fields: [String] { bindings.withLock { $0.map(\.field) } }

    /// 替换连按绑定；有绑定而监听还没启动时启动它。启动失败（多半是缺权限）抛出原因。
    func set(_ new: [Binding], dispatch: @escaping @Sendable (HotkeyAction) -> Void) throws(ModifierTap.Failure) {
        bindings.withLock { $0 = new }
        guard !new.isEmpty else { return }
        try start(dispatch: dispatch)
    }

    /// 监听还没启动就启动它。
    func start(dispatch: @escaping @Sendable (HotkeyAction) -> Void) throws(ModifierTap.Failure) {
        guard !started else { return }
        try ModifierTap.start { [self] input in
            if let action = route(input, nowMs: Self.nowMs()) { dispatch(action) }
        }
        started = true
    }

    /// 喂给判定器，凑成连按就返回绑定的功能。纯同步，selftest 直接喂事件验它。
    func route(_ input: TapInput, nowMs: UInt64) -> HotkeyAction? {
        guard let key = detector.feed(input: input, nowMs: nowMs) else { return nil }
        return bindings.withLock { $0.first { doubleTapMatches(tap: $0.tap, key: key) }?.action }
    }

    /// 单调时钟（毫秒），不受改系统时间影响。
    static func nowMs() -> UInt64 { DispatchTime.now().uptimeNanoseconds / 1_000_000 }

    /// 换绑定但不启动监听（清空绑定、selftest）。
    func replaceBindings(_ new: [Binding]) { bindings.withLock { $0 = new } }
}
