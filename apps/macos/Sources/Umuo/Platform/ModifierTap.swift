import CoreGraphics
import Foundation
import os
import UmuoCore

/// 修饰键监听，对应 `crates/umuo-platform-macos/src/modifier_tap.rs`。
///
/// 系统的全局快捷键只能注册「修饰键 + 主键」，⌃⌃ 这种只按修饰键的组合注册不了，
/// 所以这里开一个**只读**的事件监听（CGEventTap，ListenOnly）：只看、不拦、不改，按键照常送到前台应用。
/// 创建它需要「输入监控」（或「辅助功能」）权限。
///
/// 监听跑在自己的线程上，带一个 CFRunLoop。macOS 在回调太慢或用户输入特殊情况下会
/// 自动停用监听（TapDisabledByTimeout / ByUserInput），收到这两个通知时立刻重新启用——
/// 否则连按快捷键会在某次卡顿后悄悄失灵，而且没有任何报错。
///
/// 只报物理键与按下 / 松开（直接用 FFI 的 `TapInput`），「是不是连按了两下」交给 Rust 的 `DoubleTapDetector`。
enum ModifierTap {
    /// 启动失败。文案与 Tauri 外壳 `double_tap.rs` 的提示逐字一致。
    enum Failure: Error, Equatable, CustomStringConvertible {
        /// 创建监听失败几乎总是缺权限。
        case permissionDenied
        case other(String)

        var description: String {
            switch self {
            case .permissionDenied: "缺少「辅助功能」或「输入监控」权限"
            case let .other(message): message
            }
        }
    }

    /// macOS 虚拟键码（kVK_*）与对应的「设备相关」标志位（NX_DEVICE*KEYMASK）。
    /// 用设备相关位而不是通用的 ⌃/⌥ 位判断按下还是松开：左右两侧同时按着时，通用位分不出松开的是哪一边。
    static let modifierKeys: [(keycode: UInt16, key: ModKey, bit: UInt64)] = [
        (0x3B, ModKey(kind: .ctrl, side: .left), 0x0000_0001),
        (0x3E, ModKey(kind: .ctrl, side: .right), 0x0000_2000),
        (0x38, ModKey(kind: .shift, side: .left), 0x0000_0002),
        (0x3C, ModKey(kind: .shift, side: .right), 0x0000_0004),
        (0x37, ModKey(kind: .cmd, side: .left), 0x0000_0008),
        (0x36, ModKey(kind: .cmd, side: .right), 0x0000_0010),
        (0x3A, ModKey(kind: .alt, side: .left), 0x0000_0020),
        (0x3D, ModKey(kind: .alt, side: .right), 0x0000_0040),
    ]

    /// 一次「修饰键状态变化」→ 哪个物理键按下或松开。fn、Caps Lock 等不参与连按的键返回 nil。
    static func modifierEvent(keycode: UInt16, flags: UInt64) -> TapInput? {
        guard let entry = modifierKeys.first(where: { $0.keycode == keycode }) else { return nil }
        return flags & entry.bit != 0 ? .down(key: entry.key) : .up(key: entry.key)
    }

    /// 按设备相关位算出现在按着的所有物理修饰键。
    static func heldKeys(flags: UInt64) -> [ModKey] {
        modifierKeys.filter { flags & $0.bit != 0 }.map(\.key)
    }

    /// 一次 FlagsChanged → 喂给判定器的事件，以及之后「按着的键」。
    ///
    /// 只报 keycode 那一个键的话，丢一次松开事件（⌃⌘Q 锁屏、切到安全输入框、监听被系统停用期间）
    /// 判定器就会以为那个键一直按着，之后所有连按都被当成「组合」——直到用户碰巧再按一次那个键。
    /// 所以每次都按事件里的**完整** flags 对一遍账：上次记着按下、这次已经不在的，补发松开；
    /// 反过来补发按下。keycode 自己的那次变化放在最后。纯函数，便于测试。
    static func reconcile(previous: [ModKey], keycode: UInt16, flags: UInt64) -> (events: [TapInput], held: [ModKey]) {
        let now = heldKeys(flags: flags)
        let own = modifierEvent(keycode: keycode, flags: flags)
        let ownKey: ModKey? = switch own {
        case let .down(key), let .up(key): key
        default: nil
        }
        var events: [TapInput] = previous.filter { !now.contains($0) && $0 != ownKey }.map { .up(key: $0) }
        events += now.filter { !previous.contains($0) && $0 != ownKey }.map { .down(key: $0) }
        // 修饰键不会自动重复：记着按下的键又来一次「按下」，说明它的松开丢了，先补上。
        if case let .down(key) = own, previous.contains(key) {
            events.append(.up(key: key))
        }
        if let own { events.append(own) }
        return (events, now)
    }

    /// 监听的事件类型：修饰键变化，加上会打断连按的按键与鼠标点击。
    static let eventMask: CGEventMask = [CGEventType.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
        .reduce(0) { $0 | (1 << $1.rawValue) }

    /// 回调线程上的状态。只在监听线程上读写。
    private final class Context {
        let onEvent: @Sendable (TapInput) -> Void
        var port: CFMachPort?
        /// 上一次看到的「按着的键」，用来对账（见 `reconcile`）。
        var held: [ModKey] = []
        init(onEvent: @escaping @Sendable (TapInput) -> Void) { self.onEvent = onEvent }
    }

    /// 创建一个只读监听但不启用。缺权限时返回 nil（系统可能顺带弹一次授权提示）。
    /// selftest 用它探测：建出来就 `CFMachPortInvalidate` 掉，不进 run loop、不收任何事件。
    static func makeTap(userInfo: UnsafeMutableRawPointer?) -> CFMachPort? {
        CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                          eventsOfInterest: eventMask, callback: { _, type, event, userInfo in
                              if let userInfo {
                                  ModifierTap.handle(type, event, Unmanaged<Context>.fromOpaque(userInfo).takeUnretainedValue())
                              }
                              // 只读监听：返回值不影响事件本身
                              return Unmanaged.passUnretained(event)
                          }, userInfo: userInfo)
    }

    private static func handle(_ type: CGEventType, _ event: CGEvent, _ context: Context) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let port = context.port { CGEvent.tapEnable(tap: port, enable: true) }
            // 停用期间的松开事件都丢了：把记着的键全部当作松开，下一次 FlagsChanged 会按真实的 flags 再对一遍。
            let held = context.held
            context.held = []
            for key in held { context.onEvent(.up(key: key)) }
        case .flagsChanged:
            let keycode = UInt16(truncatingIfNeeded: event.getIntegerValueField(.keyboardEventKeycode))
            let (changes, now) = reconcile(previous: context.held, keycode: keycode, flags: event.flags.rawValue)
            context.held = now
            for change in changes { context.onEvent(change) }
        default:
            context.onEvent(.other)
        }
    }

    /// 开始监听，之后每个事件都在监听线程上回调 `onEvent`（回调要快）。阻塞到监听建好或失败。
    ///
    /// 失败通常是缺权限，**失败后可以再次调用**（用户授权之后重试）；成功后监听一直跑到进程退出，不应再调用。
    static func start(onEvent: @escaping @Sendable (TapInput) -> Void) throws(Failure) {
        let outcome = OSAllocatedUnfairLock<Result<Void, Failure>?>(initialState: nil)
        let ready = DispatchSemaphore(value: 0)
        let thread = Thread {
            // context 被回调引用，故意泄漏：监听活到进程结束
            let context = Context(onEvent: onEvent)
            let userInfo = Unmanaged.passRetained(context).toOpaque()
            guard let port = makeTap(userInfo: userInfo) else {
                Unmanaged<Context>.fromOpaque(userInfo).release()
                outcome.withLock { $0 = .failure(.permissionDenied) }
                ready.signal()
                return
            }
            guard let source = CFMachPortCreateRunLoopSource(nil, port, 0) else {
                CFMachPortInvalidate(port)
                Unmanaged<Context>.fromOpaque(userInfo).release()
                outcome.withLock { $0 = .failure(.other("无法为修饰键监听创建事件源")) }
                ready.signal()
                return
            }
            context.port = port
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
            CGEvent.tapEnable(tap: port, enable: true)
            outcome.withLock { $0 = .success(()) }
            ready.signal()
            CFRunLoopRun()
        }
        thread.name = "umuo-modifier-tap"
        thread.start()
        ready.wait()
        let result = outcome.withLock { $0 } ?? .failure(.other("修饰键监听线程意外退出"))
        try result.get()
    }
}
