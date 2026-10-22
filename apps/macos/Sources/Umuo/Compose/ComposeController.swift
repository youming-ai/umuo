import AppKit
import SwiftUI
import UmuoCore

/// 撰写窗的宿主：窗口的唤出、收起与快捷键，Engine 事件 → `ComposeSession`，以及 `ComposeBackend` 的正式实现。
/// 对应 Tauri 的 `toggle_compose` / `show_compose` / `open_compose_with` / `compose_translate` /
/// `compose_back_translate` / `compose_commit`。
///
/// 线程（ARCHITECTURE §2.3）：这个类在 MainActor 上；Engine 的同步方法、AX（前台 pid、切回前台）、剪贴板与合成按键
/// 一律在 `Task.detached` 里做，结果再回主线程。sink 只 `yield`（复用浮窗的 `PanelStreamSink`）。
@MainActor
final class ComposeController: ComposeBackend {
    /// 撰写窗的请求登记名（`umuo_app::translate::Mode::Compose.surface()`）。主译文与回译同在这一个名下。
    nonisolated static let surface = "compose"

    let session = ComposeSession()
    unowned let app: AppModel
    private var monitor: Any?
    /// 每次唤出加一：后台取到的前台 pid 只认最新的那次唤出。
    private var openGeneration = 0

    private lazy var window: ComposeWindow = {
        let window = ComposeWindow(rootView: ComposeView(session: session))
        installKeyMonitor(window)
        return window
    }()

    init(app: AppModel) {
        self.app = app
        session.backend = self
    }

    var isVisible: Bool { window.isVisible }

    // MARK: - 唤出与收起

    /// ⌥⌘A 与菜单栏共用：可见就收起，不可见就居中唤出并聚焦。
    ///
    /// 唤出**之前**记下前台应用：⌘⇧↩ 要粘回的是它（`remember_compose_owner`）。前台是 umuo 自己时没有目标。
    func toggle() {
        if window.isVisible { return hideCompose() }
        present { frontmost in ComposeRules.owner(frontmost, own: PanelController.ownToken) }
    }

    /// 浮窗的「在撰写窗打开」：要的是**显示**而不是切换（撰写窗已经开着时，切换会把它收起来——正好相反）。
    /// 粘贴目标按这一次的来源重新算，不保留旧值（`open_compose_with`）。
    func open(_ prefill: ComposePrefill) {
        present { frontmost in
            ComposeRules.ownerForCaller(frontmost: frontmost, panelOwner: prefill.sourceOwner,
                                        own: PanelController.ownToken)
        } then: { [session] in session.prefill(prefill.text) }
    }

    /// 前台 pid 是 AX 调用，后台现查；取到后再显示——撰写窗不激活 umuo，但先显示再取也可能取到用户刚切过去的应用。
    private func present(owner: @escaping @Sendable (String?) -> String?, then: (@MainActor () -> Void)? = nil) {
        openGeneration += 1
        let generation = openGeneration
        Task.detached {
            let frontmost = FrontmostApp.liveToken()
            await MainActor.run {
                guard self.openGeneration == generation else { return }
                self.session.owner = owner(frontmost)
                self.show()
                then?()
            }
        }
    }

    private func show() {
        refreshAppearance()
        refreshChoices()
        // 每次唤出都重新居中：用户可能刚把窗口拖到别的屏幕
        window.center()
        window.makeKeyAndOrderFront(nil)
        // SwiftUI 第一次布局完才有 NSTextView
        DispatchQueue.main.async { [window] in window.focusInput() }
    }

    func hideCompose() {
        openGeneration += 1
        window.orderOut(nil)
    }

    /// 主题、界面语言与界面缩放跟设置走，每次唤出时重读（与浮窗同一套规则）。
    private func refreshAppearance() {
        let prefersDark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let appearance = PanelRules.appearance(settingsJson: app.settingsJson, prefersDark: prefersDark)
        session.theme = appearance.theme
        session.locale = appearance.locale
        session.scale = appearance.scale
        window.invalidateShadow()
    }

    /// 能选的供应商与风格。每次唤出都重读（Tauri 只在窗口建好时读一次，刚配的 Key 要重启才出现）。
    /// `configuredProviders` 逐家读 Keychain，后台做。
    private func refreshChoices() {
        guard let engine = app.engine else { return }
        Task.detached {
            let providers = engine.configuredProviders()
            let styles = engine.styleCatalog()
            await MainActor.run {
                self.session.providers = providers
                self.session.styles = styles
            }
        }
    }

    /// 只接管撰写窗自己的按键；输入法组字时原样放行。
    private func installKeyMonitor(_ window: ComposeWindow) {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self, weak window] event in
            guard let window, event.window === window else { return event }
            let flags = event.modifierFlags
            let key = ComposeKey.of(keyCode: event.keyCode,
                                    command: flags.contains(.command) || flags.contains(.control),
                                    shift: flags.contains(.shift),
                                    composing: MainActor.assumeIsolated { window.isComposingText })
            guard let key else { return event }
            MainActor.assumeIsolated {
                switch key {
                case .escape: self?.session.escape()
                case let .commit(paste): self?.session.commit(paste: paste)
                }
            }
            return nil
        }
    }

    // MARK: - ComposeBackend

    func translate(_ request: TranslateRequest) -> String? {
        guard let engine = app.engine else { return app.engineStatus }
        let (stream, continuation) = AsyncStream.makeStream(of: PanelStreamSink.Item.self)
        let sink = PanelStreamSink(continuation)
        Task {
            for await item in stream { self.session.apply(route: item.route, event: item.event) }
        }
        Task.detached {
            sink.attach(engine.translate(request: request, guardToken: nil, sink: sink))
        }
        return nil
    }

    /// 语言由 Rust 从文本推断，与浮窗同一个发音人；朗读器全应用共用一个（「停上一段再念」）。
    func speak(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        app.speech.speak(trimmed, language: detectLanguage(text: trimmed))
    }

    /// `compose_commit`：写剪贴板 → 收起撰写窗 →（⌘⇧↩）切回原来的应用、确认它确实在前台后再粘贴。
    /// 确认不了（从 umuo 自己的窗口唤出、原应用已退出、没有辅助功能权限）就只留在剪贴板里，
    /// 并用浮窗说一声——撰写窗已经收起，它自己的提示没人看得见。
    func commit(_ text: String, paste: Bool, owner: String?) async -> String? {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return ComposeRules.emptyText }
        // 拿剪贴板互斥锁：⌘C 取词降级的事务可能正在另一个线程上跑，不在主线程上等
        if let failure = await Task.detached(operation: { ScreenOCR.copy(text) }).value { return failure }
        hideCompose()
        guard paste else { return nil }
        let failure = await Task.detached { Self.pasteBack(text, owner: owner) }.value
        if let failure { app.panel?.showNotice(failure, permission: nil) }
        return failure
    }

    /// 把唤出撰写窗之前的应用叫回前台，轮询到它真的在前台再粘贴。固定等一段时间不够：撰写窗收起后接过焦点的
    /// 可能是 umuo 自己的设置窗或历史窗，⌘V 会落进那里（审查 M19）。同步阻塞，后台调。
    nonisolated static func pasteBack(_ text: String, owner: String?) -> String? {
        guard let owner else { return ComposeRules.pasteNotBack }
        ReplaceSelection.refocus(owner)
        guard FrontmostApp.liveToken() == owner else { return ComposeRules.pasteNotBack }
        // 写入与粘贴在同一把剪贴板锁里做完（中间插进一次 ⌘C 取词降级的话，粘出去的是它清空或恢复后的内容）
        do { try ReplaceSelection.pasteFallback(text) } catch { return error.detail }
        return nil
    }
}
