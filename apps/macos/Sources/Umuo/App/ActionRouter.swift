import Foundation

/// 全局快捷键要不要真的注册（Carbon 组合键与连按监听）。
///
/// 开发期 SwiftUI 版与 Tauri 版常常同时开着：两个进程抢同一个快捷键时**后注册的静默失败**
/// （AGENTS.md「发布门槛实测」第 2 条），用户按 ⌥D 弹出来的是哪个版本全看启动顺序。
/// 所以默认**只有正式客户端**才注册：从打包好的 .app 启动、Bundle ID 是 `app.umuo.desktop`（阶段 5 组装）。
/// `.build/debug/Umuo` 没有 Info.plist，Bundle ID 为空，默认不注册。
///
/// 两个启动参数覆盖默认：`--hotkeys` 开发时强制注册（先退出 Tauri 版），`--no-hotkeys` 正式包也不注册（排查用）。
enum HotkeyPolicy {
    static func shouldRegister(arguments: [String], bundleIdentifier: String?, productionBundleId: String) -> Bool {
        if arguments.contains("--no-hotkeys") { return false }
        if arguments.contains("--hotkeys") { return true }
        return bundleIdentifier == productionBundleId
    }
}

/// 核心快捷键功能的分发处。处理函数由各窗口（浮窗、输入翻译、截图）在接上时 `handle` 进来；
/// 还没接上的功能按下去只打一行日志，不崩、不弹窗。
///
/// 暂停与录键的拦截不在这里，在 `HotkeyCenter` 的那一处（所有入口共用一个 `suspended`）。
@MainActor
final class ActionRouter {
    private var handlers: [HotkeyAction: @MainActor () -> Void] = [:]
    /// 已接上处理函数的功能。
    var handled: Set<HotkeyAction> { Set(handlers.keys) }
    /// 授权门控（`LicenseGate.gate`）：返回 false 就不执行，由它负责告诉用户为什么。nil = 不门控。
    var gate: (@MainActor (HotkeyAction) -> Bool)?

    /// 接上（或替换）一个功能的处理函数。
    func handle(_ action: HotkeyAction, _ handler: @escaping @MainActor () -> Void) {
        handlers[action] = handler
    }

    /// 执行一个功能。返回有没有处理函数接住它。
    @discardableResult
    func perform(_ action: HotkeyAction) -> Bool {
        guard let handler = handlers[action] else {
            print("umuo: 「\(action.rawValue)」还没有接上窗口（阶段 3 的对应窗口里接）")
            return false
        }
        // 被门控拦下也算接住了：说明已经弹给用户
        if let gate, !gate(action) { return true }
        handler()
        return true
    }
}
