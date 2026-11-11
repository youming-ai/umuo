import AppKit
import os
import SwiftUI
import UmuoCore

/// 浮窗的宿主：NSPanel 的显示、定位与收起，Engine 事件 → `PanelSession`，以及 `PanelBackend` 的正式实现。
///
/// 线程（ARCHITECTURE §2.3）：这个类在 MainActor 上；Engine 的同步方法、AX（取词、前台 pid、写回）、剪贴板互斥
/// 一律在 `Task.detached` 里做，结果再回主线程。Engine 的 sink 只把事件 `yield` 进 `AsyncStream`，
/// 这里在 MainActor 上逐个取出来交给 `PanelSession`——不 `DispatchQueue.main.sync`。
@MainActor
final class PanelController: PanelBackend {
    /// 浮窗的请求登记名（`umuo_app::translate::PANEL_SURFACE`）。
    nonisolated static let surface = "panel"
    /// 本应用自己的前台标识，与 `FrontmostApp.liveToken()` 同一口径（pid）。
    nonisolated static let ownToken = String(ProcessInfo.processInfo.processIdentifier)

    let session = PanelSession()
    unowned let app: AppModel
    private lazy var window: PanelWindow = {
        let window = PanelWindow(rootView: PanelView(session: session))
        window.onEscape = { [weak self] in self?.userEscape() }
        return window
    }()

    /// 每次显示加一：显示之后在后台取到的归属只认最新的那次显示。
    private var showGeneration = 0
    /// 划词 / 原地替换按键的先后（见 `TriggerGate`）。只在 MainActor 上读写。
    var triggers = TriggerGate()
    /// 截图翻译的框选（`screencapture -i`）正在进行：再按一次快捷键直接忽略，不再起第二个框选。只在 MainActor 上读写。
    var ocrInFlight = false
    private var watchdog: Task<Void, Never>?
    /// 浮窗可见期间的 Esc（见 `armEscape`），与语音浮层共用一个注册者，按最近认领的一方路由。
    private var escape: EscapeRouter { app.escape }

    init(app: AppModel) {
        self.app = app
        session.backend = self
    }

    // MARK: - 显示与收起

    /// 把浮窗放到鼠标旁边显示，并在后台记下「这次翻译属于哪个应用」（看门狗、替换原文用）。
    ///
    /// 归属**在显示之后**取：那是一次 AX 往返，只服务于 500 ms 一轮的看门狗，排在前面就是白白拖慢唤起。
    /// 取到之前先清空：清空 = 看门狗不收起；沿用上一次的归属的话，换了应用划词会被当场判成「切走」。
    func showNearCursor() {
        refreshAppearance()
        place()
        window.orderFrontRegardless()
        syncEscape()
        startWatchdog()
        showGeneration += 1
        let generation = showGeneration
        session.owner = nil
        Task.detached {
            let token = FrontmostApp.liveToken()
            await MainActor.run {
                if self.showGeneration == generation { self.session.owner = token }
            }
        }
    }

    /// 截图翻译这类**不经划词**的入口：浮窗没开就开出来；已经开着就不挪位置（免得把用户正在看的浮窗拽到鼠标下）。
    ///
    /// 无论开没开，归属都重设为本应用自己：原文不来自任何应用，没有可替换的原文；
    /// 也不能沿用上一次划词的归属（「替换原文」会把 OCR 译文写进那个应用）。先写归属再显示。
    func ensureShown() {
        showGeneration += 1
        // 浮窗换成了这次的内容：还没取完的划词按键不能再把它挪走、把归属改回某个应用
        triggers.invalidate()
        session.owner = Self.ownToken
        refreshAppearance()
        if !window.isVisible {
            place()
            window.orderFrontRegardless()
        }
        syncEscape()
        startWatchdog()
    }

    func hidePanel() {
        window.orderOut(nil)
        escape.release(.panel)
        watchdog?.cancel()
        watchdog = nil
    }

    /// 按 `session.capturesGlobalEscape` 同步全局 Esc：未钉住或正在流式翻译时挂载，已钉住且空闲时注销。
    func syncEscape() {
        guard window.isVisible, session.capturesGlobalEscape else {
            escape.release(.panel)
            return
        }
        armEscape()
    }

    /// 浮窗可见期间把 Esc 注册成系统级热键（Carbon，无需 TCC 权限），收起时注销。
    ///
    /// 为什么不靠窗口的 keyDown：浮窗是非激活面板且 `becomesKeyOnlyIfNeeded`，弹出后、点按钮后都不是 key，
    /// Esc 根本到不了它——而 Esc 是取消流式翻译的唯一途径。
    /// 也不让浮窗在显示 / 点击时成为 key：「替换原文」的 ⌘V 兜底发往 HID，落在 key 窗口上，浮窗是 key 就粘进了自己。
    /// 代价：浮窗开着时 Esc 被它独占，不再送到源应用；收起即恢复。OCR 原文框是 key 时也先走这里，不会处理两次。
    /// 语音浮层同时可见时，Esc 给最近弹出的那一个（`EscapeRouter`）；注册不上时退回窗口自己的 keyDown。
    private func armEscape() {
        escape.claim(.panel) { [weak self] in
            guard let self else { return }
            // 系统级热键先于输入法拿到 Esc：OCR 原文框里正在组字（拼音、日文候选）时，这一下只取消组字
            if self.cancelComposition() { return }
            self.userEscape()
        }
    }

    /// 用户按了 Esc（取消翻译或收起浮窗）：还没取完的按键一并作废，免得取完后又把浮窗弹出来。
    private func userEscape() {
        triggers.invalidate()
        session.escape()
    }

    /// 浮窗是 key、第一响应者是正在组字的文本视图时，丢弃未上屏的组字（等同输入法自己处理 Esc），返回 true。
    private func cancelComposition() -> Bool {
        guard window.isKeyWindow, let view = window.firstResponder as? NSTextView, view.hasMarkedText() else {
            return false
        }
        view.inputContext?.discardMarkedText()
        // 输入法没有同步清掉时，自己把标记区换成空串
        if view.hasMarkedText() { view.insertText("", replacementRange: view.markedRange()) }
        return true
    }

    /// kVK_Escape
    nonisolated static let escapeKeyCode: UInt32 = 0x35

    private func place() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        let visible = screen?.visibleFrame ?? NSRect(origin: .zero, size: PanelRules.initialSize)
        window.setFrameTopLeftPoint(PanelRules.topLeft(mouse: mouse, size: window.frame.size, visible: visible))
    }

    /// 界面语言跟设置走（`AppModel.locale`，所有窗口同一个）；主题由 `ThemeChoice.apply` 设到整个应用上。
    /// 每次显示时重读：设置改了之后下一次弹出浮窗生效。
    private func refreshAppearance() {
        session.locale = app.locale
    }

    /// 「切走就收起」看门狗（PRD §7.1：失焦关闭，可钉住）。
    ///
    /// 为什么轮询：浮窗不激活、不拿焦点，没有可靠的失焦事件；用户真正想表达的是「切到了别的应用」。
    /// 500 ms 一次，**只在浮窗可见时才查**（收起时整个循环停掉）；前台 pid 是 AX 调用，后台取，
    /// 判据是 Rust 的 `should_auto_hide`（拿不到标识不收起、前台是自己不算切走）。
    private func startWatchdog() {
        guard watchdog == nil else { return }
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                // 控制器没了就结束循环，不再空转
                guard let self else { return }
                guard self.window.isVisible else { continue }
                let owner = self.session.owner
                let pinned = self.session.pinned
                let current = await Task.detached { FrontmostApp.liveToken() }.value
                // 取 pid 的这一会儿里浮窗可能已经换了归属或被钉住：以最新的为准
                guard self.window.isVisible, owner == self.session.owner, pinned == self.session.pinned else { continue }
                if shouldAutoHide(pinned: pinned, owner: owner, current: current, own: Self.ownToken) {
                    self.hidePanel()
                }
            }
        }
    }

    // MARK: - 翻译与提示

    /// 开始一次浮窗的翻译。`Engine.translateWithTicket` 是同步方法（核对凭据、交给运行时），在后台调；
    /// 事件按顺序进这次请求自己的 `AsyncStream`，在 MainActor 上逐个交给 session（它按 requestId 丢旧事件）。
    ///
    /// `ticketId`：划词与原地替换按下快捷键时 `beginRequest` 登记的那一次。带上它就沿用这张凭据
    /// （`translateWithTicket`），不再登记新的——取词慢的旧按键否则会后登记、拿到更大的 id，旧译文反而赢；
    /// 已被更新的请求顶掉时什么都不跑。重试、重译、截图翻译不带，在这里（主线程上、按调用顺序）登记新请求。
    ///
    /// 登记与取消（`cancelTranslation`）都在主线程上同步做：它们只是加锁改一张表。放进各自的后台任务就没有先后，
    /// Esc 之后立刻重试时，迟到的取消可能打掉新请求；连着两次重译，旧的一次也可能后登记而赢。
    func startTranslation(_ request: TranslateRequest, guardToken: String? = nil, ticketId: UInt64? = nil) {
        guard let engine = app.engine else {
            showNotice(app.engineStatus, permission: nil)
            return
        }
        let ticketId = ticketId ?? engine.beginRequest(surface: Self.surface)
        let (stream, continuation) = AsyncStream.makeStream(of: PanelStreamSink.Item.self)
        let sink = PanelStreamSink(continuation)
        Task {
            for await item in stream { self.session.apply(route: item.route, event: item.event) }
        }
        Task.detached {
            // 被顶掉了：收掉这个流，等事件的那个 Task 才会结束
            guard let handle = engine.translateWithTicket(request: request, ticketId: ticketId,
                                                          guardToken: guardToken, sink: sink)
            else { return sink.finish() }
            sink.attach(handle)
        }
    }

    /// 不经流水线的提示（取词失败、黑名单、缺权限、截图识别不到文字）：登记一次新请求（顶掉浮窗上还在流的旧翻译），
    /// 以这个 id 发一条错误，并把浮窗弹出来——用户按了快捷键就该在同一个地方看到结果。
    func showNotice(_ message: String, permission: PermissionKind?, actions: [SuggestedAction] = []) {
        guard let engine = app.engine else {
            session.apply(.error(PanelError(requestId: nil, message: message, actions: actions,
                                            needsPermission: permission != nil, permission: permission, source: nil)))
            showNearCursor()
            return
        }
        // 同步登记：与 `startTranslation` / `cancelTranslation` 保持按调用顺序
        let id = engine.beginRequest(surface: Self.surface)
        report(requestId: id, message: message, permission: permission, actions: actions)
        showNearCursor()
    }

    /// 以给定的请求 id 发一条错误（取词路径：id 是按快捷键时登记的那一次）。
    func report(requestId: UInt64, message: String, permission: PermissionKind?, actions: [SuggestedAction] = []) {
        session.apply(.error(PanelError(requestId: requestId, message: message, actions: actions,
                                        needsPermission: permission != nil, permission: permission, source: nil)))
    }

    // MARK: - PanelBackend

    func translate(_ request: TranslateRequest) { startTranslation(request) }

    func abandonPendingTrigger() { triggers.invalidate() }

    func cancelTranslation() {
        guard let engine = app.engine else { return }
        // 同步取消：放进后台任务的话，Esc 后立刻重试，迟到的取消可能打掉新登记的请求
        engine.cancelSurface(surface: Self.surface)
    }

    func copy(_ text: String) async -> String? {
        // 拿剪贴板互斥锁：⌘C 取词降级的事务可能正在另一个线程上跑（最长约 1 秒），不在主线程上等
        let t = session.t
        return await Task.detached { Pasteboard.copy(text) }.value.map { t($0) }
    }

    /// 语言由 Rust 从文本推断，不由界面传：同一段文本在浮窗与撰写窗必须用同一个发音人。
    func speak(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        app.speech.speak(trimmed, language: detectLanguage(text: trimmed))
    }

    func stopSpeaking() { app.speech.stop() }

    func replace(_ text: String, original: String, owner: String?) async -> String? {
        let t = session.t
        return await Task.detached { Self.replaceSource(text, original: original, owner: owner, t: t) }.value
    }

    func openCompose(text: String, translation: String?, owner: String?) {
        app.openCompose(ComposePrefill(text: text, translation: translation, sourceOwner: owner))
    }

    func openSettings() { app.openSettings() }

    func openSystemSettings(_ permission: PermissionKind) {
        let pane = permission == .screenRecording ? "Privacy_ScreenCapture" : "Privacy_Accessibility"
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: - 替换原文

    /// 把译文写回源应用的选区（PRD §5.2「替换原文（若源 App 可写）」）。同步阻塞，后台调。
    ///
    /// 守卫用**显示浮窗时记下的那个应用**：与静默翻译同一套保护，用户切走了就不写回。
    /// 浮窗是真·非激活面板，点按钮不会激活 umuo，所以通常直接走 `.write`；前台恰好是 umuo 自己的别的窗口时，
    /// 先把源应用切回前台、等焦点回来再写（`.refocus`）。
    ///
    /// 显示浮窗时没取到源应用（应用无响应、安全输入）就拒绝：没有可比对的标识，此刻的前台可能早已是别的应用。
    ///
    /// 前台查询、切前台、AX 与受控粘贴可注入：测试换成假的，不碰真实系统。
    nonisolated static func replaceSource(
        _ text: String, original: String, owner: String?, t: Translate,
        frontmost: () -> String? = FrontmostApp.liveToken,
        refocus: (String) -> Void = ReplaceSelection.refocus,
        probe: FocusedTextProbing = AXTextProbe(), paster: ControlledPaste = ControlledPaste()
    ) -> String? {
        switch planReplace(owner: owner, current: frontmost(), own: ownToken) {
        case .noSource: return noSourceMessage()
        case .unknownSource: return t("panel.replaceUnknownSource")
        case .refocus: if let owner { refocus(owner) }
        case .write: break
        }
        // 焦点没回来时守卫会如实拒绝（目标已改变），不会写到别处
        if let refusal = replaceTargetError(owner: owner, current: frontmost()) { return refusal }
        guard let owner else { return t("panel.replaceUnknownSource") }
        do {
            try ReplaceSelection.replace(text, original: original, owner: owner, probe: probe, paster: paster,
                                         frontmost: frontmost)
        } catch {
            return writeBackFailedMessage(detail: t(error.text))
        }
        return nil
    }
}

/// 一次浮窗翻译的 sink：在 Rust 工作线程上只 `yield`，不碰主线程。
/// 结束事件（Done / Error）之后收尾这个流；流被提前终止（消费方没了）时取消这次请求。
final class PanelStreamSink: TranslateSink, @unchecked Sendable {
    struct Item: Sendable {
        let route: Route
        let event: TranslateEvent
    }

    private let continuation: AsyncStream<Item>.Continuation
    /// 句柄在 `Engine.translate` 返回之后才有；那之前流就结束了的话，拿到句柄当场取消。
    private let handle = OSAllocatedUnfairLock<(handle: RequestHandle?, terminated: Bool)>(initialState: (nil, false))

    init(_ continuation: AsyncStream<Item>.Continuation) {
        self.continuation = continuation
        continuation.onTermination = { [handle] _ in
            let current = handle.withLock { state -> RequestHandle? in
                state.terminated = true
                return state.handle
            }
            current?.cancel()
        }
    }

    func attach(_ request: RequestHandle) {
        let terminated = handle.withLock { state -> Bool in
            state.handle = request
            return state.terminated
        }
        // 已经收到结束事件时取消是空操作（幂等）；消费方提前没了才真的有用
        if terminated { request.cancel() }
    }

    /// 没有请求可等（凭据已被顶掉）时收尾。
    func finish() { continuation.finish() }

    func onEvent(route: Route, event: TranslateEvent) {
        continuation.yield(Item(route: route, event: event))
        switch event {
        case .done, .error: continuation.finish()
        case .start, .delta, .card: break
        }
    }
}
