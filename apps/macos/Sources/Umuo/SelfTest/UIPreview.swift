import AppKit
import SwiftUI
import UmuoCore

/// 开发用静态预览：不读用户设置、不访问 Keychain、不调用模型，也不注册快捷键。
/// 用 `--preview-ui` 启动，与正常应用入口分开，便于人工检查真实 AppKit 窗口。
@MainActor
struct UIPreview: App {
    init() {
        DispatchQueue.main.async { Task { await PreviewWindows.show() } }
    }

    var body: some Scene {
        MenuBarExtra("umuo", systemImage: "character.bubble", isInserted: .constant(false)) { EmptyView() }
    }
}

@MainActor
private enum PreviewWindows {
    static var windows: [NSWindow] = []
    static let backend = PreviewSettingsBackend()

    static func show() async {
        NSApp.setActivationPolicy(.regular)
        NSApp.appearance = NSAppearance(named: CommandLine.arguments.contains("--preview-dark") ? .darkAqua : .aqua)
        let locale = CommandLine.arguments.first { $0.hasPrefix("--preview-locale=") }
            .flatMap { AppLocale(rawValue: String($0.dropFirst("--preview-locale=".count))) } ?? .source
        backend.values["locale"] = .string(locale.rawValue)
        let panel = PanelSession()
        panel.locale = locale
        panel.apply(.start(PanelStart(requestId: 1,
                                     text: "Good design makes a useful tool feel effortless. Keep the important things clear, and let everything else stay quietly in the background.",
                                     provider: "OpenAI", model: "gpt-4o-mini", targetLang: "简体中文",
                                     wordMode: false, mode: .selection)))
        panel.apply(.delta(requestId: 1, text: "好的设计让实用的工具用起来毫不费力。让重要的内容清晰可见，让其他细节安静地退到背景中。"))
        panel.apply(.done(PanelDone(requestId: 1, model: "gpt-4o-mini", inputTokens: 48,
                                   outputTokens: 42, estimated: false, firstTokenMs: 320,
                                   totalMs: 980, replaced: false)))
        let result = PanelWindow(rootView: PanelView(session: panel))
        result.setContentSize(NSSize(width: 420, height: 320))
        result.setFrameOrigin(NSPoint(x: 40, y: 150))
        result.orderFrontRegardless()

        let compose = ComposeSession()
        compose.locale = locale
        compose.autoTranslate = false
        compose.input = "设计应该让表达更简单。"
        let input = ComposeWindow(rootView: ComposeView(session: compose))
        input.setFrameOrigin(NSPoint(x: 480, y: 100))
        input.orderFrontRegardless()

        let voiceModel = VoicePreviewFixture.makeModel()
        voiceModel.t = Translate(locale: locale)
        let voiceText = "好的设计，让你专注于真正重要的事。"
        switch CommandLine.arguments.first(where: { $0.hasPrefix("--preview-voice=") }) {
        case "--preview-voice=result": voiceModel.phase = .undelivered(text: voiceText, transcript: voiceText, reason: .focusChanged)
        case "--preview-voice=processing": voiceModel.phase = .postProcessing(transcript: voiceText)
        case "--preview-voice=model": voiceModel.phase = .needsModel
        case "--preview-voice=error":
            voiceModel.phase = .failed(failure: VoiceFailure(kind: .postProcess, detail: "请检查模型连接后重试。"), transcript: voiceText)
        default: voiceModel.phase = .recording
        }
        let voice = VoicePanelController.makePanel(origin: CGPoint(x: 40, y: 80))
        let voiceHosting = FloatingPanelChrome.apply(to: voice, rootView: VoiceOverlayView(model: voiceModel), sizesToContent: true)
        voice.isReleasedWhenClosed = false
        voiceModel.onCancel = { [weak voice] in voice?.orderOut(nil) }
        voice.setContentSize(NSSize(width: VoicePanelController.width, height: VoicePanelController.fittedHeight(voiceHosting)))

        let model = SettingsModel(backend: backend)
        await model.load()
        model.tab = .general
        let settings = NSWindow(contentViewController: SettingsPaneController(model: model, updater: nil))
        settings.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        settings.contentMinSize = SettingsPaneController.paneSize
        settings.setContentSize(NSSize(width: 820, height: 600))
        settings.isReleasedWhenClosed = false
        settings.center()
        windows = [result, input, voice, settings]
        NSApp.activate(ignoringOtherApps: true)
        switch CommandLine.arguments.first(where: { $0.hasPrefix("--preview-window=") }) {
        case "--preview-window=panel":
            input.orderOut(nil)
            result.center()
            result.makeKeyAndOrderFront(nil)
        case "--preview-window=compose":
            result.orderOut(nil)
            input.center()
            input.makeKeyAndOrderFront(nil)
        case "--preview-window=voice":
            result.orderOut(nil)
            input.orderOut(nil)
            voice.center()
            voice.makeKeyAndOrderFront(nil)
        default:
            result.orderOut(nil)
            input.orderOut(nil)
            settings.makeKeyAndOrderFront(nil)
        }
    }
}

/// 所有修改仅留在内存，确保检查界面时不会改动用户配置或申请权限。
@MainActor
private final class PreviewSettingsBackend: SettingsBackend {
    var values: SettingsValues = [
        "locale": .string("zh-CN"), "theme": .string("system"), "targetLang": .string("zh-CN"),
        "nativeLang": .string("zh-CN"), "secondaryTargetLang": .string("en"),
        "providerId": .string("openai"), "model": .string("gpt-4o-mini"),
        "historyEnabled": .bool(true), "historyRetentionDays": .number(90),
    ]

    func loadSettings() async throws -> SettingsValues { values }
    func applyPatch(_ patch: SettingsValues) async throws -> SettingsValues {
        values.merge(patch) { _, new in new }
        return values
    }
    func providers() async -> [ProviderDetail] { [] }
    func keyStatus(_: String) async throws -> Bool { true }
    func saveApiKey(_: String, _: String) async throws {}
    func deleteApiKey(_: String) async throws {}
    func listModels(_: String) async throws -> [String] { [] }
    func permissions() async -> PermissionStatus { PermissionStatus(accessibility: true, screenRecording: true) }
    func requestScreenRecording() async {}
    func openSystemSettings(_: PermissionKind) {}
    func openURL(_: String) {}
    func autostartStatus() async -> Bool? { false }
    func setAutostart(_ enabled: Bool) async throws -> Bool { enabled }
    func hotkeyFailures() -> [String] { [] }
    func setHotkeyRecording(_: Bool) {}
    func exportConfig() async throws -> String { "" }
    func previewImport(_: String) async throws -> PendingImport {
        throw EngineError.Failed(message: "静态预览不导入配置")
    }
    func importConfig(_: String) async throws -> ImportResult {
        throw EngineError.Failed(message: "静态预览不导入配置")
    }
    func openHistory() {}
    func openOnboarding() {}
    var appVersion: String? { "预览" }
}

/// 语音预览与布局自检共用固定模型，不下载、不读真实模型目录。
@MainActor
enum VoicePreviewFixture {
    static func makeModel() -> VoiceOverlayModel {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let spec = VoiceModelStore.Spec(url: URL(string: "https://example.invalid/model")!, sizeBytes: 589_560_480,
                                       sha256: "fixture", path: directory.appendingPathComponent("model"),
                                       partialPath: directory.appendingPathComponent("partial"))
        let model = VoiceOverlayModel(models: VoiceModelStore(spec: spec, fetcher: PreviewModelFetcher()))
        model.hotkeyLabels = [.tidy: "⌥⌘V", .translate: "⌃⌘V"]
        model.recordingSince = Date().addingTimeInterval(-8)
        return model
    }
}

private struct PreviewModelFetcher: ModelFetching {
    func fetch(_: URL, from _: Int64) async throws -> ModelFetchResponse { throw CancellationError() }
}
