import AppKit
import SwiftUI

/// 浮窗本体：真正的非激活 NSPanel（点按钮不抢走源应用的焦点）。
///
/// - `.nonactivatingPanel`：点它不会激活 umuo，用户的编辑焦点与选区留在原来的应用里——
///   按 ⌥D 是想看译文，不是想把焦点从正在写的文档里挪走；「替换原文」也因此通常不用先切回源应用。
/// - `becomesKeyOnlyIfNeeded`：点按钮不拿键盘焦点，只有点进文本框（OCR 结果的可改原文）才成为 key。
///   所以 Esc 不靠窗口收：浮窗可见期间由 `PanelController.armEscape` 注册成系统级热键；这里的 keyDown 只是兜底。
/// - 浮动层级、出现在所有桌面空间与全屏应用之上；切到别的应用不自动隐藏（收起由看门狗按前台应用判断）。
/// - 外壳是系统的（`FloatingPanelChrome`）：圆角、阴影、拖边缩放都由窗口框架负责，不再自己画。
final class PanelWindow: NSPanel {
    /// Esc 的兜底（只有浮窗是 key 时才收得到；平时走 `PanelController.armEscape` 的系统级热键）。
    var onEscape: (() -> Void)?

    init(rootView: some View) {
        super.init(contentRect: NSRect(origin: .zero, size: PanelRules.initialSize),
                   styleMask: FloatingPanelChrome.styleMask, backing: .buffered, defer: true)
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        isReleasedWhenClosed = false
        minSize = PanelRules.minSize
        animationBehavior = .utilityWindow
        // 窗口大小由用户与 `PanelRules` 决定，不跟着内容伸缩：译文一长窗口就往屏幕外长
        FloatingPanelChrome.apply(to: self, rootView: rootView)
    }

    // OCR 结果的原文要能打字，所以能成为 key；主窗口永远不当。
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_: Any?) { onEscape?() }

    override func keyDown(with event: NSEvent) {
        // kVK_Escape：没有第一响应者时 cancelOperation 不一定走得到
        if event.keyCode == 53 { onEscape?() } else { super.keyDown(with: event) }
    }
}

/// header 的拖动区（PRD §5.2「可拖动」）：按下就交给系统拖整窗。里面的按钮叠在它上面，照常可点。
/// 窗口不设「整窗可拖」：那样选译文里的字会变成拖窗口。
struct WindowDragHandle: NSViewRepresentable {
    final class View: NSView {
        override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
        override var mouseDownCanMoveWindow: Bool { true }
    }

    func makeNSView(context _: Context) -> View { View() }
    func updateNSView(_: View, context _: Context) {}
}

/// 浮窗与撰写窗共用的系统外壳：带标题栏的面板，但标题栏透明、不显示标题与红绿灯，内容铺满整窗
/// （`.fullSizeContentView`）。这样圆角、阴影、四边拖动缩放都是窗口框架自己的，与系统面板一致。
///
/// macOS 26 的底板使用 `floatingSurface` 的 Liquid Glass；更早系统回落到 `NSVisualEffectView`。
/// 回落材质固定为 `.active`：这两个面板都是非激活的，跟随窗口状态会一直显示成非活动样式。
@MainActor
enum FloatingPanelChrome {
    static let styleMask: NSWindow.StyleMask = [.titled, .fullSizeContentView, .nonactivatingPanel, .resizable]

    /// 返回承载 SwiftUI 内容的视图：按内容定高的面板（语音浮层）拿它的 `fittingSize` 调窗口大小。
    @discardableResult
    static func apply(to window: NSPanel, rootView: some View) -> NSView {
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.titlebarSeparatorStyle = .none
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            window.standardWindowButton(button)?.isHidden = true
        }
        window.isMovableByWindowBackground = false

        let hosting = NSHostingView(rootView: rootView.floatingSurface())
        hosting.sizingOptions = []
        // 标题栏是透明的、内容从窗口顶边开始：不要标题栏高度的安全区，否则顶上空出一条
        hosting.safeAreaRegions = []
        if #available(macOS 26.0, *) {
            window.backgroundColor = .clear
            window.isOpaque = false
            window.contentView = hosting
        } else {
            let surface = NSVisualEffectView()
            surface.material = .popover
            surface.blendingMode = .behindWindow
            surface.state = .active
            hosting.frame = surface.bounds
            hosting.autoresizingMask = [.width, .height]
            surface.addSubview(hosting)
            window.contentView = surface
        }
        return hosting
    }
}
