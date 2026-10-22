import AppKit
import os
import SwiftUI
import UmuoCore

/// 对比窗的宿主：快捷键入口（取词 → 开窗 → 对比）、窗口、Engine 事件 → `CompareSession`，以及 `CompareBackend` 的正式实现。
/// 对应 Tauri 的 `compare::trigger` / `build_compare` / `show_compare` / `hide_compare` / `record_compare_pick`。
///
/// 线程（ARCHITECTURE §2.3）：这个类在 MainActor 上；取词、Engine 的同步方法、剪贴板一律在 `Task.detached` 里做。
/// sink 只 `yield`，这里在 MainActor 上逐个取出来交给 session（它按 `runId` 丢旧事件）。
@MainActor
final class CompareController: NSObject, CompareBackend, NSWindowDelegate {
    /// 对比的请求登记名（与 FFI 的 `COMPARE_SURFACE`、Tauri 的 `COMPARE_LABEL` 同值）。
    nonisolated static let surface = "compare"

    let session = CompareSession()
    unowned let app: AppModel
    private var monitor: Any?

    /// PRD §7.1「对比窗：可调整大小的普通窗口」：最多 4 张卡片横排，每张都要放下一段译文与一行计量，
    /// 浮窗的 420px 装不下。尺寸与 Tauri 的 `build_compare` 相同；置顶。
    private lazy var window: NSWindow = {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 460),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: true)
        window.title = "umuo 对比"
        window.minSize = NSSize(width: 640, height: 320)
        window.level = .floating
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: CompareView(session: session))
        window.delegate = self
        window.center()
        installKeyMonitor(window)
        return window
    }()

    init(app: AppModel) {
        self.app = app
        super.init()
        session.backend = self
    }

    // MARK: - 入口

    /// 快捷键 / 菜单栏触发。取词与划词翻译同源（选区优先，失败降级复制）。
    ///
    /// 按下快捷键就顶掉上一轮（`beginRequest`）：上一轮最多 4 路计费请求不该在看不见的地方继续跑；
    /// 取词成功后沿用这张凭据（`compareWithTicket`），先按的键不会因为取词慢而后来居上。
    func trigger() {
        guard let engine = app.engine else {
            show()
            session.apply(CompareAction.notice(runId: session.state.runId, message: app.engineStatus))
            return
        }
        Task.detached {
            let id = engine.beginRequest(surface: Self.surface)
            // 与划词同一道取词黑名单（Tauri 的对比入口漏了这一道）：密码管理器里的文字不该被同时发给四家。
            if let notice = PanelController.blockNotice(engine) {
                await MainActor.run {
                    self.show()
                    self.session.apply(CompareAction.notice(runId: id, message: notice))
                }
                return
            }
            let read = Result { () throws(SelectionError) in try Selection.readSelection() }
            await MainActor.run {
                self.show()
                switch read {
                case let .failure(error):
                    self.session.apply(CompareAction.notice(runId: id, message: error.description))
                case let .success(text):
                    self.start(text, ticketId: id, engine: engine)
                }
            }
        }
    }

    private func start(_ text: String, ticketId: UInt64, engine: Engine) {
        let (stream, continuation) = AsyncStream.makeStream(of: CompareEvent.self)
        let sink = CompareStreamSink(continuation)
        Task {
            for await event in stream { self.session.apply(event) }
        }
        Task.detached {
            // 被顶掉了：收掉这个流
            guard let handle = engine.compareWithTicket(text: text, ticketId: ticketId, sink: sink) else {
                return sink.finish()
            }
            sink.attach(handle)
        }
    }

    /// 唤出对比窗（取词结束后）。已开着时只做前置。设置与排行每次唤出都重读：用户可能刚改过快捷键、刚选过。
    /// 要先 `activate`：菜单栏应用不激活的话窗口开在前台应用后面，Esc 也到不了这里。
    func show() {
        session.endDrag()
        refreshAppearance()
        refreshSideData()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    private func refreshAppearance() {
        let prefersDark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let appearance = PanelRules.appearance(settingsJson: app.settingsJson, prefersDark: prefersDark)
        session.theme = appearance.theme
        session.locale = appearance.locale
        session.scale = appearance.scale
        session.compareKeys = Self.compareKeys(settingsJson: app.settingsJson)
    }

    /// 空状态提示里的对比快捷键：设置的 `compareHotkey` 排成键帽文字。读不到就不提。
    nonisolated static func compareKeys(settingsJson: String?) -> String? {
        guard let value = settingsJson.flatMap(JSONValue.object(json:))?["compareHotkey"]?.stringValue,
              !value.isEmpty
        else { return nil }
        return HotkeyFormat.parts(value).joined()
    }

    private func refreshSideData() {
        guard let engine = app.engine else { return }
        Task.detached {
            let picks = engine.comparePicks()
            await MainActor.run { self.session.picks = picks }
        }
    }

    private func installKeyMonitor(_ window: NSWindow) {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self, weak window] event in
            // kVK_Escape
            guard let window, event.window === window, event.keyCode == 53 else { return event }
            MainActor.assumeIsolated { self?.session.escape() }
            return nil
        }
    }

    // MARK: - CompareBackend

    func cancelCompare() {
        guard let engine = app.engine else { return }
        Task.detached { engine.cancelSurface(surface: Self.surface) }
    }

    func hideCompare() { window.orderOut(nil) }

    func recordPick(providerId: String, model: String) async throws -> [ComparePick] {
        guard let engine = app.engine else { throw EngineError.Failed(message: app.engineStatus) }
        return try await Task.detached {
            try engine.recordComparePick(providerId: providerId, model: model)
        }.value
    }

    func copy(_ text: String) async -> String? {
        await Task.detached { ScreenOCR.copy(text) }.value
    }
}

/// 一轮对比的 sink：在 Rust 工作线程上只 `yield`，不碰主线程。
///
/// 对比没有「整轮结束」的事件（N 张卡各自 done / error，或者只有一条 notice），所以流在 Rust 丢掉这个 sink 时
/// 收尾（`deinit`：`compare::run` 返回、四路都落定之后）；消费方先没了时取消这一轮。
final class CompareStreamSink: CompareSink, @unchecked Sendable {
    private let continuation: AsyncStream<CompareEvent>.Continuation
    private let handle = OSAllocatedUnfairLock<(handle: RequestHandle?, terminated: Bool)>(initialState: (nil, false))

    init(_ continuation: AsyncStream<CompareEvent>.Continuation) {
        self.continuation = continuation
        continuation.onTermination = { [handle] _ in
            let current = handle.withLock { state -> RequestHandle? in
                state.terminated = true
                return state.handle
            }
            current?.cancel()
        }
    }

    deinit { continuation.finish() }

    func attach(_ request: RequestHandle) {
        let terminated = handle.withLock { state -> Bool in
            state.handle = request
            return state.terminated
        }
        if terminated { request.cancel() }
    }

    func finish() { continuation.finish() }

    func onEvent(event: CompareEvent) {
        continuation.yield(event)
        if case .notice = event { continuation.finish() }
    }
}
