import AppKit
import SwiftUI
import UmuoCore

/// 历史窗的宿主：普通的可聚焦窗口（要打字搜索），一个进程只有一个，关掉再开复用同一个窗口与模型
/// （Tauri 的 `open_history`：760×620、最小 560×420、标题「umuo 翻译历史」）。
///
/// 常驻窗口关掉再打开只是重新显示：**每次成为 key 都重读**，否则期间新翻译的记录都看不到（审查 L25）。
@MainActor
final class HistoryWindowController: NSObject, NSWindowDelegate {
    unowned let app: AppModel
    let model: HistoryModel

    private lazy var window: NSWindow = {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 620),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: true)
        window.title = "umuo 翻译历史"
        window.minSize = NSSize(width: 560, height: 420)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: HistoryView(model: model))
        window.delegate = self
        window.center()
        return window
    }()

    init(app: AppModel) {
        self.app = app
        model = HistoryModel(backend: EngineHistoryBackend(app: app))
        super.init()
    }

    /// 菜单栏应用开窗前要先 `activate`，否则窗口开在当前前台应用的后面。
    func show() {
        refreshAppearance()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    /// 内核刚打开：历史窗若在内核就绪前就开了（页头停在「历史不可用：内核启动中…」），现在重读。
    func engineReady() {
        guard window.isVisible else { return }
        Task { await model.reload() }
    }

    private func refreshAppearance() {
        let appearance = PanelRules.appearance(settingsJson: app.settingsJson)
        model.t = Translate(locale: appearance.locale)
    }

    func windowDidBecomeKey(_: Notification) {
        refreshAppearance()
        Task { await model.reload() }
    }
}

/// 正式实现。线程（ARCHITECTURE §2.3）：Engine 的同步方法（SQLite、设置）一律在 `Task.detached` 里调。
@MainActor
final class EngineHistoryBackend: HistoryBackend {
    unowned let app: AppModel

    init(app: AppModel) { self.app = app }

    private func engine() throws -> Engine {
        guard let engine = app.engine else { throw EngineError.Failed(message: app.engineStatus) }
        return engine
    }

    func query(_ filter: HistoryFilter, limit: UInt32) async throws -> [HistoryRecord] {
        let engine = try engine()
        return try await Task.detached { try engine.historyQuery(filter: filter, limit: limit, offset: 0) }.value
    }

    func privacyMode() async throws -> Bool {
        let engine = try engine()
        let json = await Task.detached { engine.settingsJson() }.value
        return JSONValue.object(json: json)?.bool("privacyMode") ?? false
    }

    func delete(id: Int64) async throws {
        let engine = try engine()
        _ = try await Task.detached { try engine.historyDelete(id: id) }.value
    }

    func clear() async throws -> UInt32 {
        let engine = try engine()
        return try await Task.detached { try engine.historyClear() }.value
    }

    func confirmClear(_ message: String, confirm: String, cancel: String) -> Bool {
        PrefConfirm.ask(message, confirm: confirm, cancel: cancel)
    }

    func copy(_ text: String) async -> String? {
        // 拿剪贴板互斥锁：⌘C 取词降级的事务可能正在另一个线程上跑，不在主线程上等
        await Task.detached { ScreenOCR.copy(text) }.value
    }

    /// 历史窗不带浮窗归属（nil）：粘贴目标只认当前前台的外部应用（`ComposeRules.ownerForCaller`）。
    func openCompose(text: String, translation: String) throws {
        app.openCompose(ComposePrefill(text: text, translation: translation, sourceOwner: nil))
    }
}
