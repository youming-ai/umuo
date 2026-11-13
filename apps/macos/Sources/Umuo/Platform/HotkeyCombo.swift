import Carbon
import UmuoCore

/// 普通组合键（`Alt+D`）→ Carbon 的虚拟键码与修饰位。
///
/// 写法沿用 `global-hotkey` 0.8 的 `parse_hotkey` 与 macOS 的 `key_to_scancode`，是已发布版本 `settings.json` 的格式：设置窗录下来的、
/// 老用户 `settings.json` 里手写的字符串必须解析成同一个键——否则升级后某个快捷键会静默回落到默认键位。
/// 只按修饰键的连按（`Ctrl Ctrl`）不经过这里，由 Rust 的 `parseHotkey` 先分流出去。
struct HotkeyCombo: Equatable, Hashable, CustomStringConvertible {
    /// `kVK_*`
    let keyCode: UInt32
    /// Carbon 修饰位：`cmdKey` / `shiftKey` / `optionKey` / `controlKey`。
    let modifiers: UInt32

    /// 解析不了返回 nil（调用方回落到这一行的默认组合键）。
    ///
    /// 语法（别名、空白、`Ctrl++D` / `Ctrl+C+A` 不合法）由 Rust 的 `parseCombo` 决定（`umuo_core::hotkey::parse_combo`），
    /// 这里只把 W3C code 名换成 Carbon 键码与修饰位。
    /// 没有虚拟键码的键（Pause、ScrollLock、F21–F24、媒体键）与 `global-hotkey` 一样算解析成功、不回落，
    /// 返回 `.unsupported`，由调用方记成这一行注册失败。唯一的出入是媒体键：`global-hotkey` 另开一个
    /// 事件监听去接它们，这里不支持（设置窗的录键器本来就录不出媒体键）。
    static func parse(_ value: String) -> Parsed? {
        guard let combo = parseCombo(value: value) else { return nil }
        var modifiers: UInt32 = 0
        if combo.ctrl { modifiers |= UInt32(controlKey) }
        if combo.alt { modifiers |= UInt32(optionKey) }
        if combo.shift { modifiers |= UInt32(shiftKey) }
        if combo.cmd { modifiers |= UInt32(cmdKey) }
        guard let keyCode = scancodes[combo.code] else { return .unsupported(combo.code) }
        return .combo(HotkeyCombo(keyCode: keyCode, modifiers: modifiers))
    }

    enum Parsed: Equatable {
        case combo(HotkeyCombo)
        /// 能解析，但这个键在 macOS 上没有虚拟键码，注册不了。
        case unsupported(String)
    }

    var description: String {
        var parts: [String] = []
        if modifiers & UInt32(controlKey) != 0 { parts.append("Ctrl") }
        if modifiers & UInt32(optionKey) != 0 { parts.append("Alt") }
        if modifiers & UInt32(shiftKey) != 0 { parts.append("Shift") }
        if modifiers & UInt32(cmdKey) != 0 { parts.append("Cmd") }
        let name = Self.scancodes.first { $0.value == keyCode }?.key ?? "0x\(String(keyCode, radix: 16))"
        return (parts + [name]).joined(separator: "+")
    }

    /// `global-hotkey` macOS 的 `key_to_scancode`（即 `kVK_*`）。媒体键、Pause、ScrollLock 不在表里。
    static let scancodes: [String: UInt32] = [
        "KeyA": 0x00, "KeyS": 0x01, "KeyD": 0x02, "KeyF": 0x03, "KeyH": 0x04, "KeyG": 0x05, "KeyZ": 0x06,
        "KeyX": 0x07, "KeyC": 0x08, "KeyV": 0x09, "KeyB": 0x0B, "KeyQ": 0x0C, "KeyW": 0x0D, "KeyE": 0x0E,
        "KeyR": 0x0F, "KeyY": 0x10, "KeyT": 0x11, "Digit1": 0x12, "Digit2": 0x13, "Digit3": 0x14,
        "Digit4": 0x15, "Digit6": 0x16, "Digit5": 0x17, "Equal": 0x18, "Digit9": 0x19, "Digit7": 0x1A,
        "Minus": 0x1B, "Digit8": 0x1C, "Digit0": 0x1D, "BracketRight": 0x1E, "KeyO": 0x1F, "KeyU": 0x20,
        "BracketLeft": 0x21, "KeyI": 0x22, "KeyP": 0x23, "Enter": 0x24, "KeyL": 0x25, "KeyJ": 0x26,
        "Quote": 0x27, "KeyK": 0x28, "Semicolon": 0x29, "Backslash": 0x2A, "Comma": 0x2B, "Slash": 0x2C,
        "KeyN": 0x2D, "KeyM": 0x2E, "Period": 0x2F, "Tab": 0x30, "Space": 0x31, "Backquote": 0x32,
        "Backspace": 0x33, "Escape": 0x35, "F17": 0x40, "NumpadDecimal": 0x41, "NumpadMultiply": 0x43,
        "NumpadAdd": 0x45, "NumLock": 0x47, "AudioVolumeUp": 0x48, "AudioVolumeDown": 0x49,
        "AudioVolumeMute": 0x4A, "NumpadDivide": 0x4B, "NumpadEnter": 0x4C, "NumpadSubtract": 0x4E,
        "F18": 0x4F, "F19": 0x50, "NumpadEqual": 0x51, "Numpad0": 0x52, "Numpad1": 0x53, "Numpad2": 0x54,
        "Numpad3": 0x55, "Numpad4": 0x56, "Numpad5": 0x57, "Numpad6": 0x58, "Numpad7": 0x59, "F20": 0x5A,
        "Numpad8": 0x5B, "Numpad9": 0x5C, "F5": 0x60, "F6": 0x61, "F7": 0x62, "F3": 0x63, "F8": 0x64,
        "F9": 0x65, "F11": 0x67, "F13": 0x69, "F16": 0x6A, "F14": 0x6B, "F10": 0x6D, "F12": 0x6F,
        "F15": 0x71, "Insert": 0x72, "Home": 0x73, "PageUp": 0x74, "Delete": 0x75, "F4": 0x76, "End": 0x77,
        "F2": 0x78, "PageDown": 0x79, "F1": 0x7A, "ArrowLeft": 0x7B, "ArrowRight": 0x7C, "ArrowDown": 0x7D,
        "ArrowUp": 0x7E, "CapsLock": 0x39, "PrintScreen": 0x46,
    ]
}
