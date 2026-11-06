import AppKit
import SwiftUI

/// 在完整 SwiftUI 应用事件循环中显示固定夹具，不读配置、不取词、不注册快捷键、不调用供应商。
/// 普通 --selftest 的 RunLoop 不会启动 SwiftUI 的窗口尺寸协商，无法复现 windowDidLayout 的布局循环。
@MainActor
struct PanelLayoutSelfTest: App {
    init() {
        DispatchQueue.main.async {
            Task { await Self.run() }
        }
    }

    var body: some Scene {
        MenuBarExtra("umuo", systemImage: "character.bubble", isInserted: .constant(false)) { EmptyView() }
    }

    private static func run() async {
        NSApp.setActivationPolicy(.accessory)
        let session = PanelSession()
        let window = PanelWindow(rootView: PanelView(session: session))
        defer { window.close() }
        window.setFrameOrigin(NSPoint(x: 80, y: 80))
        let initial = window.frame.size
        window.orderFrontRegardless()
        await settle()
        var stable = window.frame.size == initial

        session.apply(.start(PanelStart(requestId: 1, text: String(repeating: "Selected text. ", count: 100),
                                        provider: "openai", model: "test", targetLang: "zh", wordMode: false,
                                        mode: .selection)))
        for _ in 0 ..< 3 {
            session.apply(.delta(requestId: 1, text: String(repeating: "流式翻译。", count: 30)))
            await settle()
            stable = stable && window.frame.size == initial
        }
        print("\(stable ? "✓" : "✗") PanelWindow.streamingLayout: 显示与长原文 / 流式更新保持初始尺寸")

        window.setContentSize(NSSize(width: 360, height: 190))
        let resized = window.frame.size
        session.sourceExpanded = true
        session.apply(.error(PanelError(requestId: 1, message: "测试错误", actions: [.retry],
                                        needsPermission: false, permission: nil, source: nil)))
        await settle()
        window.orderOut(nil)
        window.orderFrontRegardless()
        await settle()
        let resizeStable = window.frame.size == resized
        let fillsWindow = window.contentView?.subviews.first?.frame.size == window.contentView?.bounds.size
        print("\(resizeStable && fillsWindow ? "✓" : "✗") PanelWindow.resizedLayout: 缩放、展开、报错与重开保持用户尺寸，内容铺满窗口")

        // 撰写窗复用同一外壳，也不能由 SwiftUI 布局反过来修改窗口尺寸。
        let compose = ComposeWindow(rootView: Text("输入翻译").frame(maxWidth: .infinity, maxHeight: .infinity))
        defer { compose.close() }
        let composeSize = compose.frame.size
        compose.orderFrontRegardless()
        await settle()
        let composeStable = compose.frame.size == composeSize
        print("\(composeStable ? "✓" : "✗") ComposeWindow.layout: 共用外壳保持撰写窗尺寸")
        exit(stable && resizeStable && fillsWindow && composeStable ? 0 : 1)
    }

    private static func settle() async {
        // 让真实显示周期跑完；同步 layoutSubtreeIfNeeded 不会经过 SwiftUI 的 windowDidLayout 回调。
        try? await Task.sleep(for: .milliseconds(200))
    }
}
