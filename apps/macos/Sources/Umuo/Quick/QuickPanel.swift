import AppKit
import SwiftUI
import UmuoCore

/// 快捷面板的宿主：从菜单栏图标下面弹出的 `NSPopover`（Tauri 的 `open_quick_panel`：340×420、置顶、无边框）。
///
/// - 它是**要抢焦点**的（与翻译浮窗相反）：「快速输入」得能打字，所以弹出前先 `activate`。
/// - 同一个入口既开又关：已经开着时再点一下就收起，比「再点一次没反应」好。
/// - 点到面板外面就收起（`.transient`）。Tauri 版不会自己收起、要再点一次图标——菜单栏应用的面板通常都是点外面就收，这里照系统习惯。
/// - 每次弹出都重读状态与外观（`QuickModel.refresh`）。
@MainActor
final class QuickPanelController: NSObject, QuickBackend, NSPopoverDelegate {
    static let size = NSSize(width: 340, height: 420)

    unowned let app: AppModel
    private(set) lazy var model = QuickModel(backend: self)
    private lazy var popover: NSPopover = {
        let popover = NSPopover()
        popover.behavior = .transient
        popover.animates = false
        popover.contentSize = Self.size
        popover.contentViewController = NSHostingController(rootView: QuickView(model: model))
        popover.delegate = self
        return popover
    }()

    init(app: AppModel) {
        self.app = app
    }

    var isShown: Bool { popover.isShown }

    /// 菜单栏图标左键、菜单里的「快捷面板…」共用。`anchor` 是菜单栏图标的按钮。
    func toggle(relativeTo anchor: NSView) {
        if popover.isShown { return popover.performClose(nil) }
        // `.transient` 在点图标的 mouseDown 就把面板收掉了，按钮的 action 在 mouseUp 才来：这时别再弹回来，
        // 否则「再点一次图标」永远收不起面板
        guard Self.shouldReopen(closedAt: closedAt, now: Self.now()) else { return }
        refreshAppearance()
        model.notice = nil
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        Task { await model.refresh() }
    }

    func hide() { if popover.isShown { popover.performClose(nil) } }

    /// 面板上一次收起的时刻（系统启动以来的秒数）。
    private var closedAt: TimeInterval = -.infinity

    /// 刚被这次点击的 mouseDown 收起（0.3 s 内）就不再弹出。
    nonisolated static func shouldReopen(closedAt: TimeInterval, now: TimeInterval) -> Bool { now - closedAt >= 0.3 }

    private nonisolated static func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }

    func popoverDidClose(_: Notification) { closedAt = Self.now() }

    private func refreshAppearance() {
        let prefersDark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let appearance = PanelRules.appearance(settingsJson: app.settingsJson, prefersDark: prefersDark)
        model.theme = appearance.theme
        model.t = Translate(locale: appearance.locale)
    }

    // MARK: - QuickBackend

    func state() async throws -> QuickState {
        guard let engine = app.engine else { throw EngineError.Failed(message: app.engineStatus) }
        let paused = app.hotkeys.paused
        // 读设置与历史库：后台调（ARCHITECTURE §2.3）
        return await Task.detached { engine.quickState(paused: paused) }.value
    }

    /// 暂停只停全局快捷键（组合键与连按共用 `HotkeyCenter.suspended`）；菜单栏与面板里的入口照常可用。
    func setPaused(_ paused: Bool) -> Bool {
        app.hotkeys.paused = paused
        return app.hotkeys.paused
    }

    /// 快速输入的「翻译」：收起面板，走与划词完全相同的流水线；浮窗自己弹出来（Tauri 的 `quick_translate`，审查 H3）。
    func translate(_ text: String) throws {
        guard let panel = app.panel else { throw EngineError.Failed(message: app.engineStatus) }
        // 先校验再收起：空文本时面板留着，说明写在面板上
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw EngineError.Failed(message: ComposeRules.emptyText)
        }
        hide()
        try panel.translateText(text, empty: ComposeRules.emptyText)
    }

    func copy(_ text: String) async -> String? {
        await Task.detached { ScreenOCR.copy(text) }.value
    }

    func openSettings() {
        hide()
        app.openSettings()
    }

    func openHistory() {
        hide()
        app.openHistory()
    }
}
