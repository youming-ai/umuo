import Foundation

/// 全局快捷键要不要真的注册（Carbon 组合键与连按监听）。
///
/// 开发时 `swift build` 出来的版本常常与正式安装的 umuo 同时开着：两个进程抢同一个快捷键时**后注册的静默失败**，
/// 用户按 ⌥D 弹出来的是哪一个全看启动顺序。所以默认**只有正式客户端**才注册：从打包好的 .app 启动、
/// Bundle ID 是 `app.umuo.desktop`。`.build/debug/Umuo` 没有 Info.plist，Bundle ID 为空，默认不注册。
///
/// 两个启动参数覆盖默认：`--hotkeys` 开发时强制注册（先退出正式安装版），`--no-hotkeys` 正式包也不注册（排查用）。
enum HotkeyPolicy {
    static func shouldRegister(arguments: [String], bundleIdentifier: String?, productionBundleId: String) -> Bool {
        if arguments.contains("--no-hotkeys") { return false }
        if arguments.contains("--hotkeys") { return true }
        return bundleIdentifier == productionBundleId
    }
}
