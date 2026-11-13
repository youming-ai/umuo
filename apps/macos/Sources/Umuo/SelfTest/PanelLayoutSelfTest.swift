import AppKit
import SwiftUI
import UmuoCore

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
        let panelProbe = ControlFrameProbe()
        let window = PanelWindow(rootView: ControlLayoutFixture(content: PanelView(session: session), probe: panelProbe))
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
        let composeSession = ComposeSession()
        composeSession.locale = .en
        composeSession.autoTranslate = false
        composeSession.input = "Design should make expression easier."
        let probe = ControlFrameProbe()
        let compose = ComposeWindow(rootView: ControlLayoutFixture(content: ComposeView(session: composeSession), probe: probe))
        defer { compose.close() }
        let composeSize = compose.frame.size
        compose.orderFrontRegardless()
        await settle()
        let initialComposeStable = compose.frame.size == composeSize
        compose.setContentSize(ComposeWindow.minSize)
        let compactSize = compose.frame.size
        await settle()
        let composeStable = initialComposeStable && compose.frame.size == compactSize
        print("\(composeStable ? "✓" : "✗") ComposeWindow.layout: 真实输入翻译界面在初始和最小尺寸下保持窗口尺寸")
        // 窗口尺寸不变不代表内容没有越界；从真实控件布局锚点核验内容边界。
        var controlsFit = true
        for locale in AppLocale.allCases {
            composeSession.locale = locale
            let t = composeSession.t
            composeSession.notice = t("compose.submitFailed", ["reason": t("compose.pasteNotBack")])
            await settle()
            for identifier in ["compose.close", "compose.translate", "compose.copy", "compose.copyPaste"] {
                let frame = probe.frames[identifier]
                let fits = frame.map { !$0.isEmpty && NSRect(origin: .zero, size: compactSize).insetBy(dx: -1, dy: -1).contains($0) } ?? false
                controlsFit = controlsFit && fits
                if !fits { print("✗ ComposeWindow.controls: \(locale.rawValue) / \(identifier) / \(String(describing: frame))") }
            }
        }
        print("\(controlsFit ? "✓" : "✗") ComposeWindow.noticeLayout: 四语言长提交提示下，最小窗口的关闭、翻译与提交按钮均在窗口内")
        // 长提示必须留在滚动内容里，最小划词窗口也始终能关闭、复制。
        var panelControlsFit = true
        window.setContentSize(PanelRules.minSize)
        for locale in AppLocale.allCases {
            session.locale = locale
            session.apply(.start(PanelStart(requestId: 2, text: "A short source.", provider: "openai",
                                            model: "test", targetLang: "zh-CN", wordMode: false, mode: .selection)))
            session.apply(.delta(requestId: 2, text: "保持文字清晰，让操作轻盈。"))
            session.apply(.done(PanelDone(requestId: 2, model: "test", inputTokens: 1, outputTokens: 1,
                                          estimated: false, firstTokenMs: nil, totalMs: 1, replaced: false,
                                          warning: String(repeating: "Long warning. ", count: 80))))
            session.actionNotice = String(repeating: "Long action notice. ", count: 80)
            await settle()
            panelControlsFit = checkControls(in: window, probe: panelProbe,
                                          identifiers: ["panel.close", "panel.copy", "panel.actions"]) && panelControlsFit
        }
        print("\(panelControlsFit ? "✓" : "✗") PanelWindow.noticeLayout: 四语言长提示不挤出最小窗口的关闭与复制操作")

        let voice = VoicePreviewFixture.makeModel()
        let voiceProbe = ControlFrameProbe()
        let voiceWindow = NSPanel(contentRect: NSRect(x: 80, y: 420, width: VoicePanelController.width, height: 120),
                                  styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel],
                                  backing: .buffered, defer: true)
        let voiceHosting = FloatingPanelChrome.apply(to: voiceWindow,
            rootView: ControlLayoutFixture(content: VoiceOverlayView(model: voice), probe: voiceProbe), sizesToContent: true)
        defer { voiceWindow.close() }
        voiceWindow.orderFrontRegardless()
        let longText = String(repeating: "保留原意与数字，结果可以复制。 ", count: 60)
        let phases: [VoicePhase] = [.needsModel, .recording, .transcribing,
            .postProcessing(transcript: longText),
            .done(text: longText, transcript: longText, truncated: true),
            .undelivered(text: longText, transcript: longText, reason: .focusChanged),
            .failed(failure: VoiceFailure(kind: .postProcess, detail: "连接失败，请检查模型设置。"), transcript: longText)]
        var voiceControlsFit = true
        for locale in AppLocale.allCases {
            voice.t = Translate(locale: locale)
            for phase in phases {
                voice.phase = phase
                await settle()
                voiceWindow.setContentSize(NSSize(width: VoicePanelController.width,
                                                  height: max(60, voiceHosting.fittingSize.height)))
                await settle()
                var identifiers = ["voice.close"]
                switch phase {
                case .done, .undelivered, .failed: identifiers.append("voice.copy")
                default: break
                }
                voiceControlsFit = checkControls(in: voiceWindow, probe: voiceProbe, identifiers: identifiers) && voiceControlsFit
                voiceControlsFit = voiceControlsFit && voiceWindow.frame.height < 600
            }
        }
        print("\(voiceControlsFit ? "✓" : "✗") VoicePanel.layout: 四语言录音、处理、下载、长结果与失败状态的操作均在窗口内")

        exit(stable && resizeStable && fillsWindow && composeStable && controlsFit && panelControlsFit && voiceControlsFit ? 0 : 1)
    }

    private static func checkControls(in window: NSWindow, probe: ControlFrameProbe, identifiers: [String]) -> Bool {
        let bounds = NSRect(origin: .zero, size: window.contentView?.bounds.size ?? .zero).insetBy(dx: -1, dy: -1)
        return identifiers.allSatisfy { identifier in
            let frame = probe.frames[identifier]
            let fits = frame.map { !$0.isEmpty && bounds.contains($0) } ?? false
            if !fits { print("✗ \(identifier): \(String(describing: frame)), bounds: \(bounds)") }
            return fits
        }
    }

    private static func settle() async {
        // 让真实显示周期跑完；同步 layoutSubtreeIfNeeded 不会经过 SwiftUI 的 windowDidLayout 回调。
        try? await Task.sleep(for: .milliseconds(200))
    }
}

/// 不通过系统 AX 取值：SwiftUI 在未启用辅助功能时可能不生成虚拟元素，CI 也要能检查边界。
@MainActor
private final class ControlFrameProbe {
    var frames: [String: CGRect] = [:]
}

private struct ControlLayoutFixture<Content: View>: View {
    let content: Content
    let probe: ControlFrameProbe

    var body: some View {
        content
            .overlayPreferenceValue(FloatingControlBounds.self) { anchors in
                GeometryReader { geometry in
                    let frames = anchors.mapValues { geometry[$0] }
                    Color.clear
                        .onChange(of: frames, initial: true) { _, frames in probe.frames = frames }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
    }
}
