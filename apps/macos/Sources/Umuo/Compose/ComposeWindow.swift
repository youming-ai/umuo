import AppKit
import SwiftUI

/// 撰写窗本体（PRD §7.1「居中浮窗，类 Spotlight」）：系统外壳（`FloatingPanelChrome`）、置顶、可缩放，与 Tauri 的 `build_compose` 同尺寸。
///
/// 与浮窗相反，它**要**成为 key——用户按 ⌥⌘A 就是为了打字。但它仍是 `.nonactivatingPanel`：成为 key、收键盘输入，
/// 却**不激活** umuo，唤出它之前的应用一直是前台应用。这样：
/// - ⌘↩ 收起后焦点直接回到原来的应用，用户接着 ⌘V 即可（Tauri 会激活自己，收起后 umuo 留在前台、没有窗口）；
/// - ⌘⇧↩ 粘贴前的「目标应用确实在前台」核对通常一次就通过；核对本身照做（`ComposeController.pasteBack`）。
final class ComposeWindow: NSPanel {
    static let initialSize = CGSize(width: 660, height: 440)
    static let minSize = CGSize(width: 520, height: 320)

    init(rootView: some View) {
        super.init(contentRect: NSRect(origin: .zero, size: Self.initialSize),
                   styleMask: FloatingPanelChrome.styleMask, backing: .buffered, defer: true)
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        // 置顶、失焦不收起（与 Tauri 一样）：收起只靠 Esc、「收起」按钮、⌥⌘A 与提交
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        minSize = Self.minSize
        animationBehavior = .utilityWindow
        FloatingPanelChrome.apply(to: self, rootView: rootView)
    }

    // 输入框要打字。
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    /// 把键盘焦点放进输入框（SwiftUI 的 TextEditor 背后是 NSTextView）。不用 `@FocusState`：只装 CLT 时编不过。
    func focusInput() {
        guard let textView = Self.firstTextView(in: contentView) else { return }
        makeFirstResponder(textView)
    }

    private static func firstTextView(in view: NSView?) -> NSTextView? {
        guard let view else { return nil }
        if let textView = view as? NSTextView, textView.isEditable { return textView }
        for child in view.subviews {
            if let found = firstTextView(in: child) { return found }
        }
        return nil
    }

    /// 输入法正在组字（拼音、假名还没上屏）时，Esc 与回车属于输入法：Esc 取消组字、不该收起窗口。
    var isComposingText: Bool {
        (firstResponder as? NSTextView)?.hasMarkedText() ?? false
    }
}

/// 撰写窗的三个快捷键：Esc 收起；⌘↩ 复制并关闭；⌘⇧↩ 复制并粘贴回原来的应用（PRD §5.3）。
/// 纯函数：按键 → 要做什么，测得到；窗口只负责把 NSEvent 换成这三个值。
enum ComposeKey: Equatable {
    case escape
    case commit(paste: Bool)

    /// kVK_Escape / kVK_Return / kVK_ANSI_KeypadEnter
    static func of(keyCode: UInt16, command: Bool, shift: Bool, composing: Bool) -> ComposeKey? {
        if composing { return nil }
        switch keyCode {
        case 53: return .escape
        // 与 Tauri 一样 ⌃↩ 也算（`metaKey || ctrlKey`）由调用方把 control 并进 command 传进来
        case 36, 76: return command ? .commit(paste: shift) : nil
        default: return nil
        }
    }
}
