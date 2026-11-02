import Carbon

/// 普通组合键（`Alt+D`）→ Carbon 的虚拟键码与修饰位。
///
/// 写法沿用旧版客户端（`global-hotkey` 0.8 的 `parse_hotkey` 与 macOS 的 `key_to_scancode`）：设置窗录下来的、
/// 老用户 `settings.json` 里手写的字符串必须解析成同一个键——否则升级后某个快捷键会静默回落到默认键位。
/// 只按修饰键的连按（`Ctrl Ctrl`）不经过这里，由 Rust 的 `parseHotkey` 先分流出去。
struct HotkeyCombo: Equatable, Hashable, CustomStringConvertible {
    /// `kVK_*`
    let keyCode: UInt32
    /// Carbon 修饰位：`cmdKey` / `shiftKey` / `optionKey` / `controlKey`。
    let modifiers: UInt32

    /// 解析不了返回 nil（调用方回落到这一行的默认组合键）。
    ///
    /// 没有虚拟键码的键（Pause、ScrollLock、F21–F24、媒体键）与 `global-hotkey` 一样算解析成功、不回落，
    /// 返回 `.unsupported`，由调用方记成这一行注册失败。唯一的出入是媒体键：`global-hotkey` 另开一个
    /// 事件监听去接它们，这里不支持（设置窗的录键器本来就录不出媒体键）。
    static func parse(_ value: String) -> Parsed? {
        let tokens = value.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        var modifiers: UInt32 = 0
        var key: String?
        if tokens.count == 1 {
            // 单个键不 trim：与 global-hotkey 相同（Rust 那边交过来之前已经整体 trim 过）
            key = parseKey(tokens[0])
            guard key != nil else { return nil }
        } else {
            for raw in tokens {
                let token = raw.trimmingCharacters(in: .whitespaces)
                // 空 token（`Ctrl++D`）、主键之后还有东西（`Ctrl+C+A`、`Ctrl+C+Shift`）都不合法
                if token.isEmpty || key != nil { return nil }
                switch token.uppercased() {
                case "OPTION", "ALT": modifiers |= UInt32(optionKey)
                case "CONTROL", "CTRL": modifiers |= UInt32(controlKey)
                case "COMMAND", "CMD", "SUPER": modifiers |= UInt32(cmdKey)
                case "SHIFT": modifiers |= UInt32(shiftKey)
                // macOS 上 CommandOrControl 就是 ⌘
                case "COMMANDORCONTROL", "COMMANDORCTRL", "CMDORCTRL", "CMDORCONTROL": modifiers |= UInt32(cmdKey)
                default:
                    guard let parsed = parseKey(token) else { return nil }
                    key = parsed
                }
            }
        }
        guard let key else { return nil }
        guard let keyCode = scancodes[key] else { return .unsupported(key) }
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

    /// `global-hotkey` 的 `parse_key`：别名 → W3C `Code` 名。不认识的返回 nil。
    static func parseKey(_ token: String) -> String? {
        let upper = token.uppercased()
        if let code = keyAliases[upper] { return code }
        // KeyA…KeyZ / A…Z
        if upper.count == 1, let c = upper.unicodeScalars.first, ("A"..."Z").contains(c) { return "Key\(upper)" }
        if upper.count == 4, upper.hasPrefix("KEY"), let c = upper.unicodeScalars.last, ("A"..."Z").contains(c) {
            return "Key\(c)"
        }
        // Digit0…9 / 0…9
        if upper.count == 1, let c = upper.unicodeScalars.first, ("0"..."9").contains(c) { return "Digit\(upper)" }
        if upper.count == 6, upper.hasPrefix("DIGIT"), let c = upper.unicodeScalars.last, ("0"..."9").contains(c) {
            return "Digit\(c)"
        }
        // Numpad0…9 / Num0…9
        for prefix in ["NUMPAD", "NUM"] where upper.count == prefix.count + 1 && upper.hasPrefix(prefix) {
            if let c = upper.unicodeScalars.last, ("0"..."9").contains(c) { return "Numpad\(c)" }
        }
        // F1…F24
        if upper.hasPrefix("F"), let n = Int(upper.dropFirst()), (1...24).contains(n), !upper.dropFirst().hasPrefix("0") {
            return "F\(n)"
        }
        return nil
    }

    private static let keyAliases: [String: String] = {
        let table: [(String, [String])] = [
            ("Backquote", ["BACKQUOTE", "`"]), ("Backslash", ["BACKSLASH", "\\"]),
            ("BracketLeft", ["BRACKETLEFT", "["]), ("BracketRight", ["BRACKETRIGHT", "]"]),
            ("Pause", ["PAUSE", "PAUSEBREAK"]), ("Comma", ["COMMA", ","]), ("Equal", ["EQUAL", "="]),
            ("Minus", ["MINUS", "-"]), ("Period", ["PERIOD", "."]), ("Quote", ["QUOTE", "'"]),
            ("Semicolon", ["SEMICOLON", ";"]), ("Slash", ["SLASH", "/"]),
            ("Backspace", ["BACKSPACE"]), ("CapsLock", ["CAPSLOCK"]), ("Enter", ["ENTER"]),
            ("Space", ["SPACE"]), ("Tab", ["TAB"]), ("Delete", ["DELETE"]), ("End", ["END"]),
            ("Home", ["HOME"]), ("Insert", ["INSERT"]), ("PageDown", ["PAGEDOWN"]), ("PageUp", ["PAGEUP"]),
            ("PrintScreen", ["PRINTSCREEN"]), ("ScrollLock", ["SCROLLLOCK"]),
            ("ArrowDown", ["ARROWDOWN", "DOWN"]), ("ArrowLeft", ["ARROWLEFT", "LEFT"]),
            ("ArrowRight", ["ARROWRIGHT", "RIGHT"]), ("ArrowUp", ["ARROWUP", "UP"]),
            ("NumLock", ["NUMLOCK"]),
            ("NumpadAdd", ["NUMPADADD", "NUMADD", "NUMPADPLUS", "NUMPLUS"]),
            ("NumpadDecimal", ["NUMPADDECIMAL", "NUMDECIMAL"]), ("NumpadDivide", ["NUMPADDIVIDE", "NUMDIVIDE"]),
            ("NumpadEnter", ["NUMPADENTER", "NUMENTER"]), ("NumpadEqual", ["NUMPADEQUAL", "NUMEQUAL"]),
            ("NumpadMultiply", ["NUMPADMULTIPLY", "NUMMULTIPLY"]),
            ("NumpadSubtract", ["NUMPADSUBTRACT", "NUMSUBTRACT"]),
            ("Escape", ["ESCAPE", "ESC"]),
            ("AudioVolumeDown", ["AUDIOVOLUMEDOWN", "VOLUMEDOWN"]), ("AudioVolumeUp", ["AUDIOVOLUMEUP", "VOLUMEUP"]),
            ("AudioVolumeMute", ["AUDIOVOLUMEMUTE", "VOLUMEMUTE"]),
            ("MediaPlay", ["MEDIAPLAY"]), ("MediaPause", ["MEDIAPAUSE"]), ("MediaPlayPause", ["MEDIAPLAYPAUSE"]),
            ("MediaStop", ["MEDIASTOP"]), ("MediaTrackNext", ["MEDIATRACKNEXT"]),
            ("MediaTrackPrevious", ["MEDIATRACKPREV", "MEDIATRACKPREVIOUS"]),
        ]
        var map: [String: String] = [:]
        for (code, aliases) in table { for alias in aliases { map[alias] = code } }
        return map
    }()

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
