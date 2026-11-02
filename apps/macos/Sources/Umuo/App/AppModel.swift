import AppKit
import Observation
import UmuoCore

/// 应用级状态：正式的 Engine 与宿主、全局快捷键、核心功能的分发。窗口按 docs/SWIFTUI-MIGRATION.md 的阶段 3 接上来。
///
/// 线程：这个类在 MainActor 上；Engine 的同步方法（打开、读写设置、SQLite）一律放进 `Task.detached`，
/// 结果再回到 MainActor（ARCHITECTURE §2.3）——主线程同步调 Engine 时，宿主回调若要等主线程就会互相卡死。
@MainActor @Observable
final class AppModel {
    let frontmost = FrontmostApp()
    /// 核心功能的处理函数，由各窗口接上。
    let actions: ActionRouter
    /// 全局组合键与连按（连按的 `DoubleTapRouter` 在它里面）。只有 `registersHotkeys` 为真才真的注册。
    let hotkeys: HotkeyCenter
    /// 见 `HotkeyPolicy`：开发期与 Tauri 版同开时默认不注册。
    let registersHotkeys: Bool
    /// `--settings`：启动时直接打开设置窗（开发用：菜单栏应用没有 Dock 图标，命令行起的时候不用再去点菜单）。
    let opensSettingsAtLaunch: Bool
    private(set) var engine: Engine?
    private(set) var engineStatus = "内核启动中…"
    /// 最近一次的整份设置（JSON）。窗口从这里读主题、界面语言；保存设置后由 `settingsApplied` 更新。
    private(set) var settingsJson: String?
    /// 朗读（浮窗与撰写窗共用一个：「停上一段再念」只有一个合成器时才成立）。
    let speech = Speech()
    /// 全局 Esc 的唯一注册者：翻译浮窗与语音浮层同时可见时按最近弹出的一方路由。没有认领者时不注册。
    let escape = EscapeRouter()
    let updater = AppUpdater()
    /// 划词浮窗。`start()` 里才建：`swift test` 会构造 AppModel，那里不该开窗口。
    @ObservationIgnored private(set) var panel: PanelController?

    /// 设置窗与撰写窗由各自的窗口组接上；没接上时浮窗里的按钮只打日志。
    @ObservationIgnored var settingsOpener: (@MainActor () -> Void)?
    @ObservationIgnored var composeOpener: (@MainActor (ComposePrefill) -> Void)?
    /// 历史窗、首次引导由各自的窗口组接上（设置页里有入口）。
    @ObservationIgnored var historyOpener: (@MainActor () -> Void)?
    @ObservationIgnored var onboardingOpener: (@MainActor () -> Void)?
    /// 设置窗。`start()` 里才建，理由同 `panel`。
    @ObservationIgnored private(set) var settingsWindow: SettingsWindowController?
    /// 撰写窗。`start()` 里才建，理由同 `panel`。
    @ObservationIgnored private(set) var compose: ComposeController?
    /// 历史窗、首次引导、快捷面板与菜单栏图标。`start()` 里才建，理由同 `panel`。
    @ObservationIgnored private(set) var history: HistoryWindowController?
    @ObservationIgnored private(set) var onboarding: OnboardingWindowController?
    @ObservationIgnored private(set) var quick: QuickPanelController?
    @ObservationIgnored private(set) var statusBar: StatusBarController?
    /// 语音输入（按住录音、松开转写，再整理或翻译，交付到录音开始时的输入框）。`start()` 里才建，理由同 `panel`。
    @ObservationIgnored private(set) var voice: VoiceController?

    init(arguments: [String] = CommandLine.arguments, bundleIdentifier: String? = Bundle.main.bundleIdentifier) {
        registersHotkeys = HotkeyPolicy.shouldRegister(
            arguments: arguments, bundleIdentifier: bundleIdentifier, productionBundleId: bundleId()
        )
        opensSettingsAtLaunch = arguments.contains("--settings")
        let router = ActionRouter()
        actions = router
        hotkeys = HotkeyCenter { action in router.perform(action) }
    }

    /// 启动：菜单栏应用（不进 Dock、不抢焦点，对应 Info.plist 的 LSUIElement）、开始跟踪前台应用、后台打开 Engine。
    func start() {
        NSApplication.shared.setActivationPolicy(.accessory)
        frontmost.start()
        updater.start()
        let panel = PanelController(app: self)
        self.panel = panel
        actions.handle(.selection) { panel.triggerSelection() }
        actions.handle(.silentReplace) { panel.triggerSilentReplace() }
        actions.handle(.ocr) { panel.triggerOcr() }
        let compose = ComposeController(app: self)
        self.compose = compose
        composeOpener = { compose.open($0) }
        actions.handle(.compose) { compose.toggle() }
        let settings = SettingsWindowController(app: self)
        settingsWindow = settings
        settingsOpener = { settings.show() }
        if opensSettingsAtLaunch { settings.show() }
        let history = HistoryWindowController(app: self)
        self.history = history
        historyOpener = { history.show() }
        let onboarding = OnboardingWindowController(app: self)
        self.onboarding = onboarding
        onboardingOpener = { onboarding.show() }
        quick = QuickPanelController(app: self)
        statusBar = StatusBarController(app: self)
        startVoice()
        if !registersHotkeys {
            print("umuo: 不是正式客户端（Bundle ID 不是 \(bundleId())），不注册全局快捷键；要注册请加 --hotkeys")
        }
        let host = SwiftHost(frontmost: frontmost)
        // Engine.open 读设置、开历史库，放后台做，不阻塞菜单栏出现
        Task.detached(priority: .userInitiated) {
            let result = Result { () throws -> Engine in
                guard let dir = defaultConfigDir() else { throw HostFailure.Failed(detail: "拿不到 HOME") }
                return try Engine.open(configDir: dir, host: host)
            }
            // 设置也在后台读好再带回主线程
            let settingsJson = try? result.get().settingsJson()
            await self.opened(result, settingsJson: settingsJson)
        }
    }

    /// 语音的宿主装配：录音器、本地转写、模型清单都在这里接上，快捷键在 Engine 打开后随其它快捷键一起注册。
    /// 不下载、不加载任何东西：模型只在用户第一次按语音键、在浮层里点「下载」时才下（PRD §7.4）。
    private func startVoice() {
        // 上次崩溃或强退留下的临时音频：启动时清掉（默认不保存音频）
        let files = VoiceAudioFiles.standard
        Task.detached(priority: .utility) { files.sweep() }
        guard let dir = defaultConfigDir() else { return print("umuo: 拿不到配置目录，语音不可用") }
        let info = voiceModelInfo(configDir: dir)
        guard let spec = VoiceModelStore.Spec(info) else { return print("umuo: 语音模型地址不合法：\(info.url)") }
        let models = VoiceModelStore(spec: spec, fetcher: URLSessionModelFetcher())
        let transcriber = LocalTranscriber(modelPath: info.path, idleUnload: TimeInterval(info.idleUnloadSecs))
        let controller = VoiceController(
            recorder: SystemVoiceRecorder(), transcriber: transcriber, models: models, files: files,
            maxRecordingMs: info.maxRecordingMs,
            copyText: { text in await Task.detached { ScreenOCR.copy(text) }.value }
        )
        let panel = VoicePanelController(model: controller.overlay, escape: escape)
        panel.settingsJson = { [weak self] in self?.settingsJson }
        controller.presenter = panel
        controller.postProcessor = EngineVoicePostProcessor { [weak self] in self?.engine }
        controller.deliverer = FocusedFieldDelivery()
        controller.overlay.hotkeyLabels = HotkeyCenter.voiceLabels([:])
        controller.overlay.onOpenMicSettings = { NSWorkspace.shared.open(MicrophoneAccess.settingsURL) }
        hotkeys.voice = (press: { controller.press($0) }, release: { controller.release() })
        voice = controller
    }

    private func opened(_ result: Result<Engine, Error>, settingsJson: String?) {
        switch result {
        case let .success(engine):
            self.engine = engine
            self.settingsJson = settingsJson
            engineStatus = "内核已连接：\(providerCatalog().count) 家供应商"
            if let settingsJson {
                voice?.overlay.hotkeyLabels = HotkeyCenter.voiceLabels(HotkeyCenter.values(settingsJson: settingsJson))
                if registersHotkeys { hotkeys.register(HotkeyCenter.values(settingsJson: settingsJson)) }
            }
            settingsWindow?.engineReady()
            history?.engineReady()
            ThemeChoice.apply(settingsJson: settingsJson)
            if Self.needsOnboarding(settingsJson: settingsJson) { scheduleOnboarding() }
        case let .failure(error):
            engineStatus = "内核启动失败：\(error)"
        }
    }

    /// 保存设置之后（设置窗、导入配置）：快捷键变了就当场重注册，不用重启。
    /// `settingsJson` 是 `SettingsUpdate.settingsJson` / `ImportResult.settingsJson`，已在后台拿到。
    func settingsApplied(settingsJson: String, hotkeysChanged: Bool) {
        self.settingsJson = settingsJson
        ThemeChoice.apply(settingsJson: settingsJson)
        if hotkeysChanged {
            voice?.overlay.hotkeyLabels = HotkeyCenter.voiceLabels(HotkeyCenter.values(settingsJson: settingsJson))
        }
        guard hotkeysChanged, registersHotkeys else { return }
        hotkeys.reregister(HotkeyCenter.values(settingsJson: settingsJson))
    }

    func openSettings() {
        guard let settingsOpener else { return print("umuo: 设置窗还没接上（阶段 3 的设置组）") }
        settingsOpener()
    }

    func openHistory() {
        guard let historyOpener else { return print("umuo: 历史窗还没接上（阶段 3 的历史组）") }
        historyOpener()
    }

    func openOnboarding() {
        guard let onboardingOpener else { return print("umuo: 首次引导还没接上（阶段 3 的引导组）") }
        onboardingOpener()
    }

    func openCompose(_ prefill: ComposePrefill) {
        guard let composeOpener else { return print("umuo: 撰写窗还没接上（阶段 3 的撰写组）") }
        composeOpener(prefill)
    }

    /// 首次启动引导（PRD §7.4）要不要弹：只看显式记下的 `onboardingDone`，不靠「有没有配 Key」推断——
    /// 明确选择先跳过的用户下次启动不该又被引导糊一次脸（ARCHITECTURE §4.11）。读不到设置时不弹。
    nonisolated static func needsOnboarding(settingsJson: String?) -> Bool {
        guard let settings = settingsJson.flatMap(JSONValue.object(json:)) else { return false }
        return settings["onboardingDone"]?.boolValue != true
    }

    /// 引导**错开 400 ms** 再开：菜单栏图标、快捷键、浮窗都还在初始化，抢在前面弹窗会显得「一启动就弹东西」。
    private func scheduleOnboarding() {
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            self.openOnboarding()
        }
    }

    func toggleQuickPanel() {
        guard let quick, let anchor = statusBar?.anchor else { return }
        quick.toggle(relativeTo: anchor)
    }

    func hideQuickPanel() { quick?.hide() }

    /// 菜单与关于页共用同一个 Sparkle 会话。
    func checkForUpdates() { updater.checkForUpdates() }

    /// 菜单里的「退出 umuo」。
    func quit() {
        stop()
        NSApplication.shared.terminate(nil)
    }

    /// 退出前注销全部快捷键。
    func stop() {
        if registersHotkeys { hotkeys.unregisterAll() }
    }
}

/// 从浮窗「在撰写窗打开」带过去的东西（Tauri 的 `open_compose_with` + `compose://prefill`）。
struct ComposePrefill: Equatable {
    let text: String
    let translation: String?
    /// 浮窗归属的源应用（pid；本应用自己 = 没有源应用）。撰写窗按 `compose_owner_for_caller` 决定 ⌘⇧Enter 粘回哪里：
    /// 调用方是浮窗时优先粘回它，是本应用自己才退回当前前台。
    let sourceOwner: String?
}
