import Carbon
import CoreGraphics
import Foundation
import os

/// 合成 ⌘C / ⌘V。
///
/// 用 CGEvent 直接投递到 HID 层，而不是走 AppleScript：后者要额外权限、延迟高、
/// 在无脚本权限的环境里会静默失败。合成键盘事件本身也要辅助功能权限——
/// 它不是「避开权限」的办法，而是「AX 读不到选区时」的替代数据通路。
enum KeyEvent {
    /// `kVK_ANSI_C`：布局里找不到 c 时的退路。
    static let keyC: CGKeyCode = 8
    /// `kVK_ANSI_V`：布局里找不到 v 时的退路。
    static let keyV: CGKeyCode = 9

    /// 在布局里找按住 ⌘ 时打出 `character` 的键码；找不到就用 `fallback`（ANSI 位置）。
    /// `translate` 给出某个键码按住 ⌘ 时打出的字符。
    static func commandKeyCode(for character: String, fallback: CGKeyCode,
                               translate: (CGKeyCode) -> String?) -> CGKeyCode {
        (0..<128).lazy.map { CGKeyCode($0) }.first { translate($0) == character } ?? fallback
    }

    /// 应用按当前布局把键码翻成字符再匹配快捷键：Dvorak 下 ANSI 的 8 / 9 号键打出 j / k，
    /// 硬编码键码会按成 ⌘J / ⌘K。带上 ⌘ 修饰去翻，「Dvorak - QWERTY ⌘」这类布局得到的是 QWERTY 位置。
    /// 取词与写回都在后台线程，只读缓存：TIS 在较新的 macOS 上断言主队列，后台调用会直接崩。
    static func copy() throws(SelectionError) { try sendCommandKey(layoutKeys.current.copy) }
    static func paste() throws(SelectionError) { try sendCommandKey(layoutKeys.current.paste) }

    /// 当前布局下 ⌘C / ⌘V 的键码。主线程写（启动时、切换输入法时），任意线程读，读不等主线程。
    static let layoutKeys = CommandKeyCache()

    /// 在主线程按当前布局重算并写进缓存。
    @MainActor static func refreshLayoutKeys() {
        layoutKeys.store(CommandKeys.resolve(translate: currentLayoutTranslate()))
    }

    /// 当前键盘布局按住 ⌘ 时每个键码打出的字符；拿不到布局数据时为 nil。
    /// 只能在主线程调：语言模式是 Swift 5，@MainActor 挡不住同步调用，再加一道运行时检查。
    @MainActor private static func currentLayoutTranslate() -> ((CGKeyCode) -> String?)? {
        dispatchPrecondition(condition: .onQueue(.main))
        let source = TISCopyCurrentKeyboardLayoutInputSource().takeRetainedValue()
        guard let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return nil }
        let data = Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue()
        let keyboardType = UInt32(LMGetKbdType())
        let command = UInt32((cmdKey >> 8) & 0xFF)
        return { key in
            // 闭包持有 source 与 data：布局数据的指针只在它们活着时有效
            withExtendedLifetime(source) {
                guard let bytes = CFDataGetBytePtr(data) else { return nil }
                let layout = UnsafeRawPointer(bytes).assumingMemoryBound(to: UCKeyboardLayout.self)
                var deadKeys: UInt32 = 0
                var length = 0
                var chars = [UniChar](repeating: 0, count: 4)
                let status = UCKeyTranslate(layout, key, UInt16(kUCKeyActionDown), command, keyboardType,
                                            OptionBits(kUCKeyTranslateNoDeadKeysMask), &deadKeys,
                                            chars.count, &length, &chars)
                return status == noErr ? String(utf16CodeUnits: chars, count: length) : nil
            }
        }
    }

    /// 造一个带 ⌘ 的按键事件但不投递。拆出来是为了 selftest 能验事件本身，又不往用户的应用里按键。
    /// 每个事件各用一个 source。
    static func make(_ key: CGKeyCode, down: Bool) throws(SelectionError) -> CGEvent {
        guard let source = CGEventSource(stateID: .combinedSessionState) else {
            throw .other(UserText("error.keyEventFailed"))
        }
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down) else {
            throw .other(UserText("error.keyEventFailed"))
        }
        event.flags = .maskCommand
        return event
    }

    private static func sendCommandKey(_ key: CGKeyCode) throws(SelectionError) {
        for down in [true, false] {
            try make(key, down: down).post(tap: .cghidEventTap)
        }
        // 给目标 App 一点时间把复制结果写进剪贴板；太快轮询会以为「没复制成功」，白白走一遍超时。
        Thread.sleep(forTimeInterval: 0.06)
    }
}

/// ⌘C 与 ⌘V 各用哪个键码。
struct CommandKeys: Equatable, Sendable {
    var copy: CGKeyCode
    var paste: CGKeyCode

    /// 还没在主线程读过布局时的退路：ANSI 位置。
    static let ansi = CommandKeys(copy: KeyEvent.keyC, paste: KeyEvent.keyV)

    /// 拿不到布局（`translate` 为 nil）时整组退回 ANSI。
    static func resolve(translate: ((CGKeyCode) -> String?)?) -> CommandKeys {
        guard let translate else { return .ansi }
        return CommandKeys(
            copy: KeyEvent.commandKeyCode(for: "c", fallback: KeyEvent.keyC, translate: translate),
            paste: KeyEvent.commandKeyCode(for: "v", fallback: KeyEvent.keyV, translate: translate)
        )
    }
}

/// 布局键码的缓存：锁只护一个小值，后台读者不会被主线程卡住。
final class CommandKeyCache: Sendable {
    private let state = OSAllocatedUnfairLock(initialState: CommandKeys.ansi)

    var current: CommandKeys { state.withLock { $0 } }

    func store(_ keys: CommandKeys) { state.withLock { $0 = keys } }
}

/// 跟踪输入法切换，切换后在主线程重读布局。
///
/// 用带 `suspensionBehavior` 的 selector 接口：菜单栏应用多数时候不是激活状态，
/// NSApplication 会在非激活时挂起分布式通知，默认行为下切换布局要等到下次激活才送达。
@MainActor
final class KeyboardLayoutWatcher: NSObject {
    func start() {
        KeyEvent.refreshLayoutKeys()
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(layoutChanged),
            name: Notification.Name(kTISNotifySelectedKeyboardInputSourceChanged as String),
            object: nil, suspensionBehavior: .deliverImmediately
        )
    }

    @objc private nonisolated func layoutChanged(_: Notification) {
        // 分布式通知送到注册时所在线程的 run loop（这里是主线程）；仍显式切回主线程，TIS 不能在别处读。
        DispatchQueue.main.async { MainActor.assumeIsolated { KeyEvent.refreshLayoutKeys() } }
    }
}
