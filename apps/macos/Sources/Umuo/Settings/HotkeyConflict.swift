import Foundation
import UmuoCore

/// 快捷键冲突检查（PRD §7.2：「录制时检查系统与已知常用 App 的冲突并提示」），`hotkey-conflict.ts` 的移植。
///
/// 只做**静态检查**：明显不成立的组合、与我们自己重复、命中已知的系统快捷键。真正「被别的应用占着」
/// 无法预先知道——macOS 只在注册时拒绝，那一半靠 `HotkeyCenter.failures` 回到界面。
enum HotkeyConflict {
    enum Kind: String, Equatable, Sendable { case noModifier = "no-modifier", duplicate, system }

    struct Conflict: Equatable, Sendable {
        let kind: Kind
        /// 简体中文说明（与 Tauri 版逐字一致）；界面按语言用 `kind` + `subject` 重组句子。
        let message: String
        /// 撞上的是谁：重复时是另一个功能的名字，系统冲突时是系统功能名。
        var subject: String?
    }

    /// 已知的系统 / 常用快捷键。抢走它们不会报错，只会让用户觉得「某个功能突然坏了」。
    private static let rawSystem: [String: String] = [
        "cmd+space": "Spotlight 搜索",
        "cmd+tab": "切换应用",
        "cmd+shift+3": "截取整个屏幕",
        "cmd+shift+4": "截取屏幕区域",
        "cmd+shift+5": "屏幕录制",
        "ctrl+up": "调度中心",
        "ctrl+down": "应用窗口",
        "ctrl+left": "移到左边的空间",
        "ctrl+right": "移到右边的空间",
        "cmd+q": "退出当前应用",
        "cmd+shift+q": "退出登录",
        "cmd+option+esc": "强制退出",
        "ctrl+cmd+q": "锁定屏幕",
    ]

    /// 查表用的表：键先归一化（表里写成 `cmd+shift+4` 而候选归一化成 `shift+cmd+4` 就永远匹配不上）。
    private static let system: [String: String] = Dictionary(
        rawSystem.map { (normalize($0.key), $0.value) }, uniquingKeysWith: { first, _ in first }
    )

    private static let aliases: [String: String] = [
        "option": "alt", "opt": "alt", "alt": "alt",
        "command": "cmd", "cmd": "cmd", "meta": "cmd", "super": "cmd",
        "control": "ctrl", "ctrl": "ctrl",
        "shift": "shift",
    ]

    private static let order = ["ctrl", "alt", "shift", "cmd"]

    /// 归一化：修饰键统一别名并**按固定顺序**排列，主键小写。`Option+D`、`Alt+D`、`alt+d` 是同一个键。
    static func normalize(_ input: String) -> String {
        let parts = input.split(separator: "+", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else { return "" }
        var modifiers = Set<String>()
        var keys: [String] = []
        for part in parts {
            if let alias = aliases[part] { modifiers.insert(alias) } else { keys.append(part) }
        }
        return (order.filter(modifiers.contains) + keys).joined(separator: "+")
    }

    /// 两个连按快捷键是否会被同一下连按触发（「⌃⌃」包含了「右⌃⌃」）。
    static func overlap(_ a: DoubleTap, _ b: DoubleTap) -> Bool {
        a.kind == b.kind && (a.side == nil || b.side == nil || a.side == b.side)
    }

    /// 连按格式走 Rust 的 `parseHotkey`（与 Tauri 版 `parseDoubleTap` 同一规则），不在 Swift 里再写一份。
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
            return Conflict(kind: .duplicate, message: "与「\(clash.label)」重复", subject: clash.label)
        }

        // 只有 Shift 不算真正的修饰键：没有真正修饰键的全局热键会**吞掉**所有应用里的这个按键。
        let parts = normalized.split(separator: "+").map(String.init)
        if !["ctrl", "alt", "cmd"].contains(where: parts.contains) {
            return Conflict(kind: .noModifier, message: "至少要有一个 ⌃ / ⌥ / ⌘ 修饰键，否则这个键在任何应用里都会被抢走")
        }

        if let clash = others.first(where: { normalize($0.value) == normalized }) {
            return Conflict(kind: .duplicate, message: "与「\(clash.label)」重复", subject: clash.label)
        }

        if let name = system[normalized] {
            return Conflict(kind: .system, message: "系统已经用它做「\(name)」，抢过来会让那个功能失效", subject: name)
        }
        return nil
    }
}
