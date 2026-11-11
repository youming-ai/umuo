import AppKit
import ApplicationServices
import UmuoCore

/// 读出来、预览过、等用户确认的一份配置包。
struct PendingImport: Sendable {
    let contents: String
    let summary: ImportSummary
}

/// 本应用里系统权限的此刻状态。nil = 没读出来。
struct PermissionStatus: Equatable, Sendable {
    var accessibility: Bool?
    var screenRecording: Bool?
}

/// 设置窗往外要做的事：Engine（设置、Key 状态、模型列表、导入导出）、Keychain、权限、
/// 开机自启、快捷键、别的窗口。正式实现是 `EngineSettingsBackend`（同步的 Engine / Keychain / 文件调用一律在后台），
/// 测试换成只记调用的假实现——设置窗的交互规则因此不碰真实 Keychain、剪贴板、TCC 就能测。
@MainActor
protocol SettingsBackend: AnyObject {
    func loadSettings() async throws -> SettingsValues
    /// 只交改了的顶层键（`applySettingsPatch`），返回规范化之后的整份设置。快捷键变了由实现负责重注册。
    func applyPatch(_ patch: SettingsValues) async throws -> SettingsValues
    func providers() async -> [ProviderDetail]
    func keyStatus(_ providerId: String) async throws -> Bool
    func saveApiKey(_ providerId: String, _ key: String) async throws
    func deleteApiKey(_ providerId: String) async throws
    func listModels(_ providerId: String) async throws -> [String]

    func permissions() async -> PermissionStatus
    func requestScreenRecording() async
    func openSystemSettings(_ permission: PermissionKind)
    func openURL(_ url: String)

    func autostartStatus() async -> Bool?
    /// 返回实际生效的状态。
    func setAutostart(_ enabled: Bool) async throws -> Bool

    /// 注册失败的快捷键（设置字段名）。
    func hotkeyFailures() -> [String]
    /// 录键期间暂停全部全局快捷键（`HotkeyCenter.setRecording`）。
    func setHotkeyRecording(_ active: Bool)

    func exportConfig() async throws -> String
    /// 读配置文件并预览，**什么都不写**。文件只读这一次：确认后用同一份内容 `importConfig`，
    /// 确认期间文件被换掉也不会应用一份没看过的配置。
    func previewImport(_ path: String) async throws -> PendingImport
    /// 应用预览过的那份内容。导入后的新设置由实现负责交给应用（快捷键重注册、浮窗的主题语言）。
    func importConfig(_ contents: String) async throws -> ImportResult

    func openHistory()
    func openOnboarding()
    var appVersion: String? { get }
}

/// 正式实现。线程（ARCHITECTURE §2.3）：类在 MainActor 上，Engine、Keychain、文件与 AX 的同步调用都放进 `Task.detached`。
@MainActor
final class EngineSettingsBackend: SettingsBackend {
    unowned let app: AppModel
    private let keychain = Keychain(service: bundleId())

    init(app: AppModel) { self.app = app }

    private func engine() throws -> Engine {
        guard let engine = app.engine else { throw EngineError.Failed(message: app.engineStatus) }
        return engine
    }

    func loadSettings() async throws -> SettingsValues {
        let engine = try engine()
        let json = await Task.detached { engine.settingsJson() }.value
        guard let values = JSONValue.object(json: json) else {
            throw EngineError.Failed(message: app.t("prefs.settingsInvalid"))
        }
        return values
    }

    func applyPatch(_ patch: SettingsValues) async throws -> SettingsValues {
        let engine = try engine()
        let json = JSONValue.json(patch)
        let update = try await Task.detached { try engine.applySettingsPatch(patchJson: json) }.value
        // 浮窗下次弹出时读到新的主题 / 语言 / 缩放；快捷键变了当场重注册
        app.settingsApplied(settingsJson: update.settingsJson, hotkeysChanged: update.hotkeysChanged)
        return JSONValue.object(json: update.settingsJson) ?? patch
    }

    func providers() async -> [ProviderDetail] {
        await Task.detached { providerDetails() }.value
    }

    func keyStatus(_ providerId: String) async throws -> Bool {
        let engine = try engine()
        return try await Task.detached { try engine.keyStatus(providerId: providerId) }.value
    }

    /// 存 Key：先过 Rust 的规则（供应商必须存在、去掉首尾空白），再写 Keychain。写入可能弹系统的授权框
    /// （覆盖旧版客户端或别的签名写的条目时），所以在后台做，不卡住设置窗。
    func saveApiKey(_ providerId: String, _ key: String) async throws {
        let keychain = keychain, t = app.t
        try await Task.detached {
            let value = try prepareApiKey(providerId: providerId, apiKey: key)
            do { try keychain.write(account: providerId, secret: value) } catch {
                throw EngineError.Failed(message: t.message(error))
            }
        }.value
    }

    func deleteApiKey(_ providerId: String) async throws {
        let keychain = keychain, t = app.t
        try await Task.detached {
            do { try keychain.delete(account: providerId) } catch { throw EngineError.Failed(message: t.message(error)) }
        }.value
    }

    func listModels(_ providerId: String) async throws -> [String] {
        let engine = try engine()
        // 阻塞等网络：只从后台调
        return try await Task.detached { try engine.listModels(providerId: providerId) }.value
    }

    func permissions() async -> PermissionStatus {
        let status = await Task.detached {
            PermissionStatus(accessibility: AXIsProcessTrusted(), screenRecording: ScreenCapture.hasPermission())
        }.value
        // 刚授完权：之前因缺权限没起来的连按快捷键（新装默认的 ⌃⌃）现在补上
        if status.accessibility == true, app.registersHotkeys { app.hotkeys.retryStart() }
        return status
    }

    func requestScreenRecording() async {
        // 每个进程只弹一次系统对话框；只在用户点了「授权」时调
        _ = await Task.detached { ScreenCapture.requestPermission() }.value
    }

    func openSystemSettings(_ permission: PermissionKind) {
        let pane = permission == .screenRecording ? "Privacy_ScreenCapture" : "Privacy_Accessibility"
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") {
            NSWorkspace.shared.open(url)
        }
    }

    func openURL(_ url: String) {
        if let url = URL(string: url) { NSWorkspace.shared.open(url) }
    }

    private nonisolated static var home: URL { FileManager.default.homeDirectoryForCurrentUser }

    func autostartStatus() async -> Bool? {
        await Task.detached { Autostart.isEnabled(home: Self.home) }.value
    }

    func setAutostart(_ enabled: Bool) async throws -> Bool {
        // 开发构建（`swift build` 的裸二进制，没有 Bundle ID）不许打开：登录项会指向 .build 里的临时二进制，
        // 还会顶掉正式安装版写的同一个 LaunchAgent。关掉不拦——那是在帮用户收拾。
        if enabled, Bundle.main.bundleIdentifier != bundleId() {
            throw EngineError.Failed(message: app.t("autostart.devBuild"))
        }
        let program = Bundle.main.executablePath ?? CommandLine.arguments[0]
        do {
            return try await Task.detached { try Autostart.setEnabled(enabled, home: Self.home, program: program) }.value
        } catch let failure as Autostart.Failure {
            throw EngineError.Failed(message: app.t(failure.text))
        }
    }

    func hotkeyFailures() -> [String] { app.hotkeys.failures }

    func setHotkeyRecording(_ active: Bool) {
        guard app.registersHotkeys else { return }
        app.hotkeys.setRecording(active)
    }

    func exportConfig() async throws -> String {
        let engine = try engine()
        return try await Task.detached { try engine.exportConfig() }.value
    }

    func previewImport(_ path: String) async throws -> PendingImport {
        let engine = try engine()
        let unreadable = app.t("prefs.general.importUnreadable")
        return try await Task.detached {
            let contents: String
            do { contents = try String(contentsOfFile: path, encoding: .utf8) } catch {
                throw EngineError.Failed(message: unreadable)
            }
            return PendingImport(contents: contents, summary: try engine.previewImport(contents: contents))
        }.value
    }

    func importConfig(_ contents: String) async throws -> ImportResult {
        let engine = try engine()
        let result = try await Task.detached { try engine.importConfig(contents: contents) }.value
        app.settingsApplied(settingsJson: result.settingsJson, hotkeysChanged: result.hotkeysChanged)
        return result
    }

    func openHistory() { app.openHistory() }
    func openOnboarding() { app.openOnboarding() }

    /// 开发构建（裸二进制）没有 Info.plist，读不到版本，界面显示「未知」。
    var appVersion: String? { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String }
}
