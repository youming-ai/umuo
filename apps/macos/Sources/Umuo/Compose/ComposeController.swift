import AppKit
import SwiftUI
import UmuoCore

/// 撰写窗的宿主：窗口的唤出、收起与快捷键，Engine 事件 → `ComposeSession`，以及 `ComposeBackend` 的正式实现。
///
/// 线程（ARCHITECTURE §2.3）：这个类在 MainActor 上；Engine 的同步方法、AX（前台 pid、切回前台）、剪贴板与合成按键
/// 一律在 `Task.detached` 里做，结果再回主线程。sink 只 `yield`（复用浮窗的 `PanelStreamSink`）。
@MainActor
final class ComposeController: ComposeBackend {
    /// 撰写窗的请求登记名（`umuo_app::translate::Mode::Compose.surface()`）。
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

    // MARK: - 唤出与收起

    /// ⌥⌘A 与菜单栏共用：可见就收起，不可见就居中唤出并聚焦。
    ///
    /// 唤出**之前**记下前台应用：⌘⇧↩ 要粘回的是它。前台是 umuo 自己时没有目标。
    func toggle() {
        if window.isVisible { return hideCompose() }
        present { frontmost in ComposeRules.owner(frontmost, own: PanelController.ownToken) }
    }

    /// 浮窗的「在撰写窗打开」：要的是**显示**而不是切换（撰写窗已经开着时，切换会把它收起来——正好相反）。
    /// 粘贴目标按这一次的来源重新算，不保留旧值。
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

    /// 界面语言跟设置走，每次唤出时重读（与浮窗同一个 `AppModel.locale`）。
    private func refreshAppearance() {
        session.locale = app.locale
    }

    /// 只接管撰写窗自己的按键；输入法组字时原样放行。
    private func installKeyMonitor(_ window: ComposeWindow) {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self, weak window] event in
            guard let window, event.window === window else { return event }
            let flags = event.modifierFlags
            let key = ComposeKey.of(keyCode: event.keyCode,
                                    command: flags.contains(.command) || flags.contains(.control),
                                    shift: flags.contains(.shift),
                                    composing: MainActor.assumeIsolated { window.isComposingText },
                                    control: flags.contains(.control))
            guard let key else { return event }
            MainActor.assumeIsolated {
                switch key {
                case .escape: self?.session.escape()
                case let .commit(paste): self?.session.commit(paste: paste)
                case .translate: self?.session.translateNow()
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

    /// 写历史库，不占主线程。粘贴没成功也记：译文已经留在剪贴板上交给用户了。
    func recordCommitted(_ requestId: UInt64) {
        guard let engine = app.engine else { return }
        Task.detached { engine.commitCompose(requestId: requestId) }
    }

    /// 语言由 Rust 从文本推断，与浮窗同一个发音人；朗读器全应用共用一个（「停上一段再念」）。
    func speak(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        app.speech.speak(trimmed, language: detectLanguage(text: trimmed))
    }

    /// 提交：⌘↩ 写剪贴板后收起；⌘⇧↩ 收起后切回原来的应用、确认它确实在前台再受控粘贴
    /// （粘完恢复用户原来的剪贴板）。确认不了（从 umuo 自己的窗口唤出、原应用已退出、没有辅助功能权限）
    /// 就只留在剪贴板里，并用浮窗说一声——撰写窗已经收起，它自己的提示没人看得见。
    func commit(_ text: String, paste: Bool, owner: String?) async -> String? {
        let t = session.t
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return t(ComposeRules.emptyText) }
        guard paste else {
            // 拿剪贴板互斥锁：⌘C 取词降级的事务可能正在另一个线程上跑，不在主线程上等
            if let failure = await Task.detached(operation: { Pasteboard.copy(text) }).value { return t(failure) }
            hideCompose()
            return nil
        }
        hideCompose()
        guard let failure = await Task.detached(operation: { Self.pasteBack(text, owner: owner) }).value else {
            return nil
        }
        app.panel?.showNotice(t(failure), permission: nil)
        return t(failure)
    }

    /// 把唤出撰写窗之前的应用叫回前台，轮询到它真的在前台再受控粘贴。固定等一段时间不够：撰写窗收起后接过焦点的
    /// 可能是 umuo 自己的设置窗或历史窗，⌘V 会落进那里（审查 M19）。同步阻塞，后台调。
    ///
    /// 粘不了时把译文留在剪贴板上（提示里让用户手动 ⌘V）。剪贴板、按键、切前台与前台查询可注入，测试不碰真实系统。
    nonisolated static func pasteBack(
        _ text: String, owner: String?, paster: ControlledPaste = ControlledPaste(),
        refocus: (String) -> Void = ReplaceSelection.refocus,
        frontmost: () -> String? = FrontmostApp.liveToken
    ) -> UserText? {
        guard let owner else { return keepOnClipboard(text, paster.pasteboard) ?? ComposeRules.pasteNotBack }
        refocus(owner)
        // ⌘V 发往前台：按下前最后核对一次前台仍是原应用
        switch paster.run(text, proceed: { frontmost() == owner }) {
        case .pasted: return nil
        case .skipped: return keepOnClipboard(text, paster.pasteboard) ?? ComposeRules.pasteNotBack
        // 不能把译文留在剪贴板上：那正好盖掉刚才为它放弃粘贴的那份大内容
        case .clipboardTooLarge: return UserText(Pasteboard.tooLarge)
        case let .failed(reason):
            _ = keepOnClipboard(text, paster.pasteboard)
            return reason
        }
    }

    /// 没粘成时把译文复制到剪贴板。复制失败返回原因。
    private nonisolated static func keepOnClipboard(_ text: String, _ pasteboard: PasteboardAccess) -> UserText? {
        Pasteboard.copy(text, to: pasteboard)
    }
}
