import AppKit
import SwiftUI
import UmuoCore

/// 首次引导的宿主：普通可聚焦窗口（要填 Key），固定 `size`、居中，标题「欢迎使用 umuo」跟着界面语言。
/// 同系统的设置助理：步骤固定、不能拉伸。
///
/// 已开着就只前置；关掉之后（走完、跳过、点关闭）再开是**从头开始**的新模型——「重新运行首次引导」要的就是重走一遍。
/// 窗口重新成为 key 时重查权限：用户多半是从系统设置里勾完权限切回来的。
@MainActor
final class OnboardingWindowController: NSObject, NSWindowDelegate {
    static let size = NSSize(width: 640, height: 560)

    unowned let app: AppModel
    private var window: NSWindow?
    private var model: OnboardingModel?

    init(app: AppModel) {
        self.app = app
    }

    func show() {
        // 只要窗口还在（含最小化）就复用，与 Tauri 的 `open_onboarding` 一致；不能看 `isVisible`——最小化时它是 false，
        // 会再开一个新窗，旧窗关闭时又把新窗的引用清掉。
        if let window {
            if window.isMiniaturized { window.deminiaturize(nil) }
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }
        let model = OnboardingModel(backend: EngineOnboardingBackend(app: app) { [weak self] in self?.close() })
        self.model = model
        refreshAppearance(model)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.size),
                              styleMask: [.titled, .closable, .miniaturizable],
                              backing: .buffered, defer: true)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: OnboardingView(model: model))
        window.delegate = self
        window.center()
        self.window = window
        refreshAppearance(model)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        Task { await model.load() }
    }

    func close() { window?.close() }

    private func refreshAppearance(_ model: OnboardingModel) {
        let appearance = PanelRules.appearance(settingsJson: app.settingsJson)
        model.t = Translate(locale: appearance.locale)
        window?.title = model.t("onboarding.title")
    }

    func windowDidBecomeKey(_: Notification) {
        guard let model, model.isLoaded else { return }
        refreshAppearance(model)
        Task { await model.recheckPermissions() }
    }

    func windowWillClose(_ notification: Notification) {
        guard (notification.object as? NSWindow) === window else { return }
        model = nil
        window = nil
    }
}

/// 正式实现：设置、Key、模型列表、权限都转给设置窗的 `EngineSettingsBackend`（同一份 Keychain 与 TCC 规则，
/// 同步调用同样在后台）；「翻一句看看」交给浮窗。
@MainActor
final class EngineOnboardingBackend: OnboardingBackend {
    unowned let app: AppModel
    private let settings: EngineSettingsBackend
    private let onClose: @MainActor () -> Void

    init(app: AppModel, onClose: @escaping @MainActor () -> Void) {
        self.app = app
        settings = EngineSettingsBackend(app: app)
        self.onClose = onClose
    }

    func loadSettings() async throws -> SettingsValues { try await settings.loadSettings() }
    func applyPatch(_ patch: SettingsValues) async throws -> SettingsValues { try await settings.applyPatch(patch) }
    func providers() async -> [ProviderDetail] { await settings.providers() }
    func keyStatus(_ providerId: String) async throws -> Bool { try await settings.keyStatus(providerId) }
    func saveApiKey(_ providerId: String, _ key: String) async throws { try await settings.saveApiKey(providerId, key) }
    func listModels(_ providerId: String) async throws -> [String] { try await settings.listModels(providerId) }
    func permissions() async -> PermissionStatus { await settings.permissions() }
    func requestScreenRecording() async { await settings.requestScreenRecording() }
    func openSystemSettings(_ permission: PermissionKind) { settings.openSystemSettings(permission) }
    func openURL(_ url: String) { settings.openURL(url) }

    func translateSample(_ text: String) throws {
        guard let panel = app.panel else { throw EngineError.Failed(message: app.engineStatus) }
        try panel.translateText(text, empty: "没有可翻译的文本")
    }

    func close() { onClose() }
}
