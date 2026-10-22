import AppKit
import SwiftUI

/// 浮窗本体：真正的非激活 NSPanel（Tauri 版做不到的那一处，迁移文档阶段 3）。
///
/// - `.nonactivatingPanel`：点它不会激活 umuo，用户的编辑焦点与选区留在原来的应用里——
///   按 ⌥D 是想看译文，不是想把焦点从正在写的文档里挪走；「替换原文」也因此通常不用先切回源应用。
/// - `becomesKeyOnlyIfNeeded`：点按钮不拿键盘焦点，只有点进文本框（OCR 结果的可改原文）才成为 key。
///   所以 Esc 不靠窗口收：浮窗可见期间由 `PanelController.armEscape` 注册成系统级热键；这里的 keyDown 只是兜底。
/// - 浮动层级、出现在所有桌面空间与全屏应用之上；切到别的应用不自动隐藏（收起由看门狗按前台应用判断）。
/// - 无边框、透明：卡片的圆角与边框由 SwiftUI 画，阴影交给窗口按内容的形状算。
final class PanelWindow: NSPanel {
    /// Esc 的兜底（只有浮窗是 key 时才收得到；平时走 `PanelController.armEscape` 的系统级热键）。
    var onEscape: (() -> Void)?

    init(rootView: some View) {
        super.init(contentRect: NSRect(origin: .zero, size: PanelRules.initialSize),
                   styleMask: [.borderless, .nonactivatingPanel, .resizable],
                   backing: .buffered, defer: true)
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        isReleasedWhenClosed = false
        // 拖动只认 header（`WindowDragHandle`）：整窗可拖的话，选译文里的字会变成拖窗口
        isMovableByWindowBackground = false
        isMovable = true
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        minSize = PanelRules.minSize
        animationBehavior = .utilityWindow

        let hosting = NSHostingView(rootView: rootView)
        // 窗口大小由用户与 `PanelRules` 决定，不跟着内容伸缩：译文一长窗口就往屏幕外长
        hosting.sizingOptions = []
        contentView = hosting
    }

    // 无边框窗口默认不能成为 key：OCR 结果的原文要能打字。主窗口永远不当。
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_: Any?) { onEscape?() }

    override func keyDown(with event: NSEvent) {
        // kVK_Escape：没有第一响应者时 cancelOperation 不一定走得到
        if event.keyCode == 53 { onEscape?() } else { super.keyDown(with: event) }
    }
}

/// header 的拖动区（PRD §5.2「可拖动」）：按下就交给系统拖整窗。里面的按钮叠在它上面，照常可点。
struct WindowDragHandle: NSViewRepresentable {
    final class View: NSView {
        override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
        override var mouseDownCanMoveWindow: Bool { true }
    }

    func makeNSView(context _: Context) -> View { View() }
    func updateNSView(_: View, context _: Context) {}
}

/// 右下角的缩放把手。无边框窗口靠边缘缩放在不同系统版本上表现不一，这里给一个一定可用的把手。
struct WindowResizeGrip: NSViewRepresentable {
    var color: NSColor

    final class View: NSView {
        var color: NSColor = .tertiaryLabelColor { didSet { needsDisplay = true } }
        private var start: (mouse: NSPoint, frame: NSRect)?

        override func draw(_: NSRect) {
            color.setStroke()
            for inset in [3.0, 7.0] {
                let path = NSBezierPath()
                path.move(to: NSPoint(x: bounds.maxX - 2, y: bounds.minY + inset))
                path.line(to: NSPoint(x: bounds.maxX - inset, y: bounds.minY + 2))
                path.lineWidth = 1
                path.stroke()
            }
        }

        override var mouseDownCanMoveWindow: Bool { false }

        override func mouseDown(with event: NSEvent) {
            guard let window else { return }
            start = (NSEvent.mouseLocation, window.frame)
        }

        override func mouseDragged(with _: NSEvent) {
            guard let window, let start else { return }
            let now = NSEvent.mouseLocation
            let width = max(window.minSize.width, start.frame.width + now.x - start.mouse.x)
            let height = max(window.minSize.height, start.frame.height - (now.y - start.mouse.y))
            // 左上角不动，往右下拉
            let frame = NSRect(x: start.frame.minX, y: start.frame.maxY - height, width: width, height: height)
            window.setFrame(frame, display: true)
        }

        override func mouseUp(with _: NSEvent) {
            start = nil
            window?.invalidateShadow()
        }
    }

    func makeNSView(context _: Context) -> View { View() }
    func updateNSView(_ view: View, context _: Context) { view.color = color }
}
