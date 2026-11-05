import AppKit
import Observation
import os
import UmuoCore

/// 应用级状态：正式的 Engine 与宿主、全局快捷键、核心功能的分发，以及各窗口控制器。
///
/// 线程：这个类在 MainActor 上；Engine 的同步方法（打开、读写设置、SQLite）一律放进 `Task.detached`，
/// 结果再回到 MainActor（ARCHITECTURE §2.3）——主线程同步调 Engine 时，宿主回调若要等主线程就会互相卡死。
@MainActor @Observable
final class AppModel {
    let frontmost = FrontmostApp()
    /// 全局组合键与连按（连按的 `DoubleTapRouter` 在它里面）。只有 `registersHotkeys` 为真才真的注册。
    /// 按下后交给 `perform`；lazy 是为了在闭包里引用 self。
    @ObservationIgnored private(set) lazy var hotkeys = HotkeyCenter { [unowned self] action in self.perform(action) }
    /// 见 `HotkeyPolicy`：开发构建默认不注册，免得与正式安装版同开时抢同一组快捷键。
    let registersHotkeys: Bool
    /// Engine 打开之后注册全局快捷键（只有 `registersHotkeys` 为真才真的注册）。
    /// 测试换成只记调用的闭包，不碰 Carbon 的全局注册。
    @ObservationIgnored lazy var registerHotkeys: @MainActor ([String: String]) -> Void = { [unowned self] values in
        guard self.registersHotkeys else { return }
        self.hotkeys.register(values)
    }
    /// `--settings`：启动时直接打开设置窗（开发用：菜单栏应用没有 Dock 图标，命令行起的时候不用再去点菜单）。
    let opensSettingsAtLaunch: Bool
    private(set) var engine: Engine?
    private var engineState = EngineState.starting
    /// 界面语言：设置里的 `locale` + 系统语言偏好。Engine 打开、保存设置后更新；各窗口直接读，不再各自解析设置 JSON。
    private(set) var locale = AppLocale.resolve(settingsJson: nil)
    /// 同一个界面语言给宿主回调（`SwiftHost`，在 tokio 工作线程上同步调用）读：不碰 MainActor。
    @ObservationIgnored let hostLocale = OSAllocatedUnfairLock(initialState: AppLocale.resolve(settingsJson: nil))
    /// 朗读（浮窗与撰写窗共用一个：「停上一段再念」只有一个合成器时才成立）。
    let speech = Speech()
    /// 全局 Esc 的唯一注册者：翻译浮窗与语音浮层同时可见时按最近弹出的一方路由。没有认领者时不注册。
    let escape = EscapeRouter()
    let updater = AppUpdater()
    /// 划词浮窗。`start()` 里才建：`swift test` 会构造 AppModel，那里不该开窗口。
    @ObservationIgnored private(set) var panel: PanelController?
    /// 设置窗、撰写窗、历史窗、首次引导、快捷面板与菜单栏图标。`start()` 里才建，理由同 `panel`。
    @ObservationIgnored private(set) var settingsWindow: SettingsWindowController?
    @ObservationIgnored private(set) var compose: ComposeController?
    @ObservationIgnored private(set) var history: HistoryWindowController?
    @ObservationIgnored private(set) var onboarding: OnboardingWindowController?
    @ObservationIgnored private(set) var quick: QuickPanelController?
    @ObservationIgnored private(set) var statusBar: StatusBarController?
    /// 语音输入（按住录音、松开转写，再整理或翻译，交付到录音开始时的输入框）。`start()` 里才建，理由同 `panel`。
    @ObservationIgnored private(set) var voice: VoiceController?

    /// 内核的状态。给用户看的句子按当前界面语言现取（`engineStatus`）。
    private enum EngineState {
        case starting
        case ready
        /// 拿不到 HOME，配置目录无从谈起。
        case noHome
        /// `Engine.open` 失败；`reason` 是 Rust 给的说明。
        case failed(reason: String)
    }

    init(arguments: [String] = CommandLine.arguments, bundleIdentifier: String? = Bundle.main.bundleIdentifier) {
        registersHotkeys = HotkeyPolicy.shouldRegister(
            arguments: arguments, bundleIdentifier: bundleIdentifier, productionBundleId: bundleId()
        )
        opensSettingsAtLaunch = arguments.contains("--settings")
    }

    /// 当前界面语言的取文案函数。
    var t: Translate { Translate(locale: locale) }

    /// Engine 还不能用时给用户看的那句话（启动中 / 启动失败的原因）。
    var engineStatus: String {
        switch engineState {
        case .starting, .ready: t("app.engineStarting")
        case .noHome: t("app.engineFailed", ["reason": t("app.noHome")])
        case let .failed(reason): t("app.engineFailed", ["reason": reason])
        }
    }

    /// 启动：菜单栏应用（不进 Dock、不抢焦点，对应 Info.plist 的 LSUIElement）、开始跟踪前台应用、后台打开 Engine。
    func start() {
        NSApplication.shared.setActivationPolicy(.accessory)
        frontmost.start()
        updater.start()
        panel = PanelController(app: self)
        compose = ComposeController(app: self)
        let settings = SettingsWindowController(app: self)
        settingsWindow = settings
        if opensSettingsAtLaunch { settings.show() }
        history = HistoryWindowController(app: self)
        onboarding = OnboardingWindowController(app: self)
        quick = QuickPanelController(app: self)
        statusBar = StatusBarController(app: self)
        startVoice()
        if !registersHotkeys {
            print("umuo: 不是正式客户端（Bundle ID 不是 \(bundleId())），不注册全局快捷键；要注册请加 --hotkeys")
        }
        let hostLocale = hostLocale
        let host = SwiftHost(frontmost: frontmost, locale: { hostLocale.withLock { $0 } })
        // Engine.open 读设置、开历史库，放后台做，不阻塞菜单栏出现
        Task.detached(priority: .userInitiated) {
            guard let dir = defaultConfigDir() else { return await self.opened(nil, settingsJson: nil) }
            let result = Result { try Engine.open(configDir: dir, host: host) }
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
            copyText: { text in await Task.detached { Pasteboard.copy(text) }.value?.key }
        )
        let panel = VoicePanelController(model: controller.overlay, escape: escape)
        panel.locale = { [weak self] in self?.locale ?? .source }
        controller.presenter = panel
        controller.postProcessor = EngineVoicePostProcessor(engine: { [weak self] in self?.engine },
                                                            unavailable: { [weak self] in self?.engineStatus ?? "" })
        controller.deliverer = FocusedFieldDelivery()
        controller.overlay.hotkeyLabels = HotkeyCenter.voiceLabels([:])
        controller.overlay.onOpenMicSettings = { NSWorkspace.shared.open(MicrophoneAccess.settingsURL) }
        hotkeys.voice = (press: { controller.press($0) }, release: { controller.release() },
                         interrupt: { controller.cancelIfHolding() })
        voice = controller
    }

    /// `result` 为 nil：拿不到 HOME，没有打开 Engine。
    func opened(_ result: Result<Engine, Error>?, settingsJson: String?) {
        switch result {
        case let .success(engine)?:
            self.engine = engine
            engineState = .ready
            if let settingsJson {
                applyLocale(settingsJson)
                voice?.overlay.hotkeyLabels = HotkeyCenter.voiceLabels(HotkeyCenter.values(settingsJson: settingsJson))
                registerHotkeys(HotkeyCenter.values(settingsJson: settingsJson))
            }
            settingsWindow?.engineReady()
            history?.engineReady()
            ThemeChoice.apply(settingsJson: settingsJson)
            if Self.needsOnboarding(settingsJson: settingsJson) { scheduleOnboarding() }
        case let .failure(error)?:
            engineState = .failed(reason: userMessage(error))
        case nil:
            engineState = .noHome
        }
    }

    /// 保存设置之后（设置窗、导入配置）：界面语言与主题当场跟上，快捷键变了就当场重注册，不用重启。
    /// `settingsJson` 是 `SettingsUpdate.settingsJson` / `ImportResult.settingsJson`，已在后台拿到。
    func settingsApplied(settingsJson: String, hotkeysChanged: Bool) {
        applyLocale(settingsJson)
        ThemeChoice.apply(settingsJson: settingsJson)
        if hotkeysChanged {
            voice?.overlay.hotkeyLabels = HotkeyCenter.voiceLabels(HotkeyCenter.values(settingsJson: settingsJson))
        }
        guard hotkeysChanged, registersHotkeys else { return }
        hotkeys.reregister(HotkeyCenter.values(settingsJson: settingsJson))
    }

    private func applyLocale(_ settingsJson: String) {
        let resolved = AppLocale.resolve(settingsJson: settingsJson)
        locale = resolved
        hostLocale.withLock { $0 = resolved }
    }

    /// 快捷键与菜单栏共用的核心功能入口。窗口还没建（`swift test` 里的 AppModel）时什么都不做。
    func perform(_ action: HotkeyAction) {
        switch action {
        case .selection: panel?.triggerSelection()
        case .silentReplace: panel?.triggerSilentReplace()
        case .ocr: panel?.triggerOcr()
        case .compose: compose?.toggle()
        }
    }

    func openSettings() { settingsWindow?.show() }
    func openHistory() { history?.show() }
    func openOnboarding() { onboarding?.show() }
    func openCompose(_ prefill: ComposePrefill) { compose?.open(prefill) }

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

/// 从浮窗「在撰写窗打开」、历史窗「再次编辑」带过去的东西。
struct ComposePrefill: Equatable {
    let text: String
    let translation: String?
    /// 浮窗归属的源应用（pid；本应用自己 = 没有源应用）。撰写窗按 `ComposeRules.ownerForCaller` 决定 ⌘⇧↩ 粘回哪里：
    /// 调用方是浮窗时优先粘回它，是本应用自己才退回当前前台。
    let sourceOwner: String?
}
