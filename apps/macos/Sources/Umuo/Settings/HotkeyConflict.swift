import Foundation
import UmuoCore

/// 快捷键冲突检查（PRD §7.2：「录制时检查系统与已知常用 App 的冲突并提示」）。
///
/// 只做**静态检查**：明显不成立的组合、与我们自己重复、命中已知的系统快捷键。真正「被别的应用占着」
/// 无法预先知道——macOS 只在注册时拒绝，那一半靠 `HotkeyCenter.failures` 回到界面。
enum HotkeyConflict {
    enum Kind: String, Equatable, Sendable { case noModifier = "no-modifier", unrecognized, duplicate, system }

    /// 界面按 `kind` + `subject` 组句子（`SettingsModel.warning`）。
    struct Conflict: Equatable, Sendable {
        let kind: Kind
        /// 撞上的是谁：重复时是另一个功能的名字（已按界面语言取好），系统冲突时是系统功能名的文案键。
        var subject: String?
    }

    /// 已知的系统 / 常用快捷键 → 系统功能名的文案键。抢走它们不会报错，只会让用户觉得「某个功能突然坏了」。
    /// 主键可以写别名（`up`、`esc`）：`normalize` 用注册时同一个解析器换成键位名，与录键器存的 `ArrowUp` 对得上。
    /// `cmd+option+esc` 录键器录不出来（录键时 Esc 是结束录制），但 settings.json 手写的值同样会过这里，所以保留。
    static let rawSystem: [String: String] = [
        "cmd+space": "prefs.hotkey.sys.spotlight",
        "cmd+tab": "prefs.hotkey.sys.switchApps",
        "cmd+shift+3": "prefs.hotkey.sys.screenshotScreen",
        "cmd+shift+4": "prefs.hotkey.sys.screenshotArea",
        "cmd+shift+5": "prefs.hotkey.sys.screenRecording",
        "ctrl+up": "prefs.hotkey.sys.missionControl",
        "ctrl+down": "prefs.hotkey.sys.appWindows",
        "ctrl+left": "prefs.hotkey.sys.spaceLeft",
        "ctrl+right": "prefs.hotkey.sys.spaceRight",
        "cmd+q": "prefs.hotkey.sys.quitApp",
        "cmd+shift+q": "prefs.hotkey.sys.logOut",
        "cmd+option+esc": "prefs.hotkey.sys.forceQuit",
        "ctrl+cmd+q": "prefs.hotkey.sys.lockScreen",
    ]

    /// 全部系统功能名的文案键（四语言齐全由测试检查）。
    static var systemKeys: [String] { Array(rawSystem.values) }

    /// 查表用的表：键先归一化（表里写成 `cmd+shift+4` 而候选归一化成 `shift+cmd+4` 就永远匹配不上）。
    private static let system: [String: String] = Dictionary(
        rawSystem.map { (normalize($0.key), $0.value) }, uniquingKeysWith: { first, _ in first }
    )

    /// 归一化：解析得了的组合键写成 `ctrl+alt+shift+cmd+<code>`（修饰键固定顺序、全小写），
    /// `Option+D` / `alt+KeyD`、`Up` / `ArrowUp`、`Esc` / `Escape` 归到同一个写法；解析不了的值只修剪并小写。
    /// 与注册用的是同一个解析器（Rust 的 `normalizeCombo` / `parseCombo`），不在 Swift 里再写一份别名表。
    static func normalize(_ input: String) -> String {
        normalizeCombo(value: input)
    }

    /// 两个连按快捷键是否会被同一下连按触发（「⌃⌃」包含了「右⌃⌃」）。
    static func overlap(_ a: DoubleTap, _ b: DoubleTap) -> Bool {
        a.kind == b.kind && (a.side == nil || b.side == nil || a.side == b.side)
    }

    /// 连按格式走 Rust 的 `parseHotkey`，不在 Swift 里再写一份。
    private static func doubleTap(_ value: String) -> DoubleTap? {
        if case let .doubleTap(tap) = parseHotkey(value: value) { tap } else { nil }
    }

    static func check(_ candidate: String, others: [(label: String, value: String)]) -> Conflict? {
        let normalized = normalize(candidate)
        // 留空 = 用默认值（Rust 侧解析失败时会回落到内置默认），不算冲突。
        if normalized.isEmpty { return nil }

        // 连按两下修饰键（⌃⌃）：本来就只有修饰键，不做「缺修饰键」检查；只查与别的功能是否撞上。
        if let tap = doubleTap(candidate) {
            guard let clash = others.first(where: { doubleTap($0.value).map { overlap(tap, $0) } ?? false }) else { return nil }
            return Conflict(kind: .duplicate, subject: clash.label)
        }

        // 组合键语法认不出来（只可能来自手写的 settings.json）：注册时会回落默认键位，直接说明这一点，
        // 不再拿原串去套「缺修饰键」「重复」这些按键规则——那些结论对一个不会被注册的值没有意义。
        // 与注册同一条路（`HotkeyCombo.resolve`）：先整体修剪，再解析组合键。
        guard HotkeyCombo.resolve(candidate) != nil else {
            return Conflict(kind: .unrecognized)
        }

        // 重复要先查：「缺修饰键」只是提醒、照样能存（F5 这类单键就是这样），先返回它的话两个功能能同时设成 F5。
        if let clash = others.first(where: { normalize($0.value) == normalized }) {
            return Conflict(kind: .duplicate, subject: clash.label)
        }

        // 只有 Shift 不算真正的修饰键：没有真正修饰键的全局热键会**吞掉**所有应用里的这个按键。
        let parts = normalized.split(separator: "+").map(String.init)
        if !["ctrl", "alt", "cmd"].contains(where: parts.contains) {
            return Conflict(kind: .noModifier)
        }

        if let name = system[normalized] {
            return Conflict(kind: .system, subject: name)
        }
        return nil
    }
}
