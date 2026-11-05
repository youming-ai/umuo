import Carbon
import CoreGraphics
import Foundation

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
    static func copy() throws(SelectionError) { try sendCommandKey(currentKey("c", fallback: keyC)) }
    static func paste() throws(SelectionError) { try sendCommandKey(currentKey("v", fallback: keyV)) }

    private static func currentKey(_ character: String, fallback: CGKeyCode) -> CGKeyCode {
        guard let translate = currentLayoutTranslate() else { return fallback }
        return commandKeyCode(for: character, fallback: fallback, translate: translate)
    }

    /// 当前键盘布局按住 ⌘ 时每个键码打出的字符；拿不到布局数据时为 nil。
    /// 在调用方的线程上读（取词与写回都不在主线程），不等主线程。
    private static func currentLayoutTranslate() -> ((CGKeyCode) -> String?)? {
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
