import CoreGraphics
import Foundation

/// 合成 ⌘C / ⌘V。
///
/// 用 CGEvent 直接投递到 HID 层，而不是走 AppleScript：后者要额外权限、延迟高、
/// 在无脚本权限的环境里会静默失败。合成键盘事件本身也要辅助功能权限——
/// 它不是「避开权限」的办法，而是「AX 读不到选区时」的替代数据通路。
enum KeyEvent {
    /// `kVK_ANSI_C`
    static let keyC: CGKeyCode = 8
    /// `kVK_ANSI_V`
    static let keyV: CGKeyCode = 9

    static func copy() throws(SelectionError) { try sendCommandKey(keyC) }
    static func paste() throws(SelectionError) { try sendCommandKey(keyV) }

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
