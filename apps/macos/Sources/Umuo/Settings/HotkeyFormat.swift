import Foundation
import UmuoCore

/// 快捷键字符串与按键之间的转换（录键器用）。
///
/// 存储格式沿用全局快捷键认的写法：`Ctrl+Alt+Shift+Cmd+P`，修饰键在前、主键在最后。
/// 主键一律按**物理键位**（W3C `KeyboardEvent.code` 的名字，由虚拟键码换算）而不是按出来的字符：
/// 按住 ⌥ 时字符会变成组合出来的符号（⌥P 是「π」），用它只会录出一串解析不了的东西。
enum HotkeyFormat {
    /// 录键器能产出的主键名（Rust 侧有测试确认它们都能解析）。
    static let recordableKeys: [String] = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789").map(String.init)
        + (1 ... 12).map { "F\($0)" }
        + ["Space", "Enter", "Tab", "Comma", "Period", "Slash", "Semicolon", "Quote", "BracketLeft", "BracketRight",
           "Backslash", "Minus", "Equal", "Backquote", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]

    /// 修饰键自己的键位名（W3C code），录键时只按了它们 = 还在等主键。
    static let modifierCodes: [UInt16: String] = [
        0x3B: "ControlLeft", 0x3E: "ControlRight", 0x3A: "AltLeft", 0x3D: "AltRight",
        0x38: "ShiftLeft", 0x3C: "ShiftRight", 0x37: "MetaLeft", 0x36: "MetaRight",
    ]

    /// 虚拟键码 → W3C code 名（`HotkeyCombo.scancodes` 反查，修饰键另表）。认不出的键返回 nil。
    static func code(keyCode: UInt16) -> String? {
        if let modifier = modifierCodes[keyCode] { return modifier }
        return reverseScancodes[UInt32(keyCode)]
    }

    private static let reverseScancodes: [UInt32: String] = Dictionary(
        HotkeyCombo.scancodes.map { ($0.value, $0.key) }, uniquingKeysWith: { first, _ in first }
    )

    /// 录键器关心的那部分按键（便于测试时手写）。
    struct Key: Equatable, Sendable {
        var code: String
        var ctrl = false
        var alt = false
        var shift = false
        var cmd = false
    }

    enum RecordResult: Equatable, Sendable {
        case combo(String)
        /// 只按了修饰键，还在等主键。
        case waiting
        /// 这个键录不了（例如数字小键盘、媒体键）。
        case unsupported
    }

    /// W3C code → 存储用的主键名；不支持的键返回 nil。
    private static func mainKey(_ code: String) -> String? {
        if code.count == 4, code.hasPrefix("Key"), let c = code.last, c.isASCII, c.isUppercase { return String(c) }
        if code.count == 6, code.hasPrefix("Digit"), let c = code.last, c.isASCII, c.isNumber { return String(c) }
        return recordableKeys.contains(code) ? code : nil
    }

    /// 把一次按下变成快捷键字符串。至少要有 ⌃ / ⌥ / ⌘ 之一（只带 ⇧ 不算），
    /// 功能键 F1–F12 例外——它们本来就不会和打字冲突。
    static func combo(from key: Key) -> RecordResult {
        guard let main = mainKey(key.code) else {
            return modifierCodes.values.contains(key.code) ? .waiting : .unsupported
        }
        let modifiers = [key.ctrl ? "Ctrl" : nil, key.alt ? "Alt" : nil, key.shift ? "Shift" : nil, key.cmd ? "Cmd" : nil]
            .compactMap { $0 }
        let real = key.ctrl || key.alt || key.cmd
        let isFunctionKey = main.hasPrefix("F") && Int(main.dropFirst()) != nil
        if !real, !isFunctionKey { return .waiting }
        return .combo((modifiers + [main]).joined(separator: "+"))
    }

    private static let modifierSymbols: [String: String] = [
        "CTRL": "⌃", "CONTROL": "⌃", "ALT": "⌥", "OPTION": "⌥", "SHIFT": "⇧", "CMD": "⌘", "COMMAND": "⌘", "SUPER": "⌘",
    ]

    private static let keySymbols: [String: String] = [
        "SPACE": "Space", "ENTER": "↩", "TAB": "⇥", "COMMA": ",", "PERIOD": ".", "SLASH": "/", "SEMICOLON": ";",
        "QUOTE": "'", "BRACKETLEFT": "[", "BRACKETRIGHT": "]", "BACKSLASH": "\\", "MINUS": "-", "EQUAL": "=",
        "BACKQUOTE": "`", "ARROWUP": "↑", "ARROWDOWN": "↓", "ARROWLEFT": "←", "ARROWRIGHT": "→",
    ]

    /// 显示用：`Alt+Shift+T` → `["⌥", "⇧", "T"]`；连按 `RightCmd RightCmd` → `["右⌘", "右⌘"]`。
    /// `rightLabel` 由调用方按界面语言给（「右」/「R」）。连按格式走 Rust 的 `parseHotkey`，不在这里再写一份。
    static func parts(_ value: String, rightLabel: String = "R") -> [String] {
        if case let .doubleTap(tap) = parseHotkey(value: value) {
            let symbol = switch tap.kind {
            case .ctrl: "⌃"
            case .alt: "⌥"
            case .shift: "⇧"
            case .cmd: "⌘"
            }
            let cap = tap.side == .right ? rightLabel + symbol : symbol
            return [cap, cap]
        }
        return value.split(separator: "+", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { token in
                let upper = token.uppercased()
                if let symbol = modifierSymbols[upper] ?? keySymbols[upper] { return symbol }
                if upper.count == 4, upper.hasPrefix("KEY"), let c = upper.last, c.isLetter { return String(c) }
                if upper.count == 6, upper.hasPrefix("DIGIT"), let c = upper.last, c.isNumber { return String(c) }
                return token.count == 1 ? upper : token
            }
    }

    /// 判定器凑出的连按 → 要保存的字符串。左侧录成「左右都算」（`Ctrl Ctrl`），右侧录成只认右侧（`RightCmd RightCmd`）：
    /// 右侧单独成键是有意义的（例如右 ⌘ 连按），左侧则是大多数人的默认手位。
    static func doubleTapValue(_ key: ModKey) -> String {
        let name = switch key.kind {
        case .ctrl: "Ctrl"
        case .alt: "Alt"
        case .shift: "Shift"
        case .cmd: "Cmd"
        }
        let full = key.side == .right ? "Right\(name)" : name
        return "\(full) \(full)"
    }
}

/// 录键器里的连按判定：直接用 Rust 的 `DoubleTapDetector`（与真正响应连按的是同一个状态机、同一组时限），
/// 每次开始录键新建一个，不与全局监听共享状态。
final class DoubleTapRecorder {
    private let detector = DoubleTapDetector()

    /// 一次修饰键变化（NSEvent 的 flagsChanged：虚拟键码 + 带设备相关位的完整 flags）。凑成连按就返回要保存的字符串。
    func modifierChanged(keyCode: UInt16, flags: UInt64, atMs: UInt64) -> String? {
        guard let input = ModifierTap.modifierEvent(keycode: keyCode, flags: flags) else { return nil }
        return detector.feed(input: input, nowMs: atMs).map(HotkeyFormat.doubleTapValue)
    }

    /// 按了别的键或点了鼠标：打断。
    func other(atMs: UInt64) {
        _ = detector.feed(input: .other, nowMs: atMs)
    }
}
