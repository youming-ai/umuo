import AppKit
import SwiftUI

/// 设置窗的排版积木（`settings/ui.tsx`）：一组（标题 + 圆角底板）里放若干行，每行左边是名字和一句说明，右边是控件。
///
/// 所有控件都是「改了就存」：下拉框与开关立刻提交；文本框是草稿，失焦或回车才提交（`DraftField`），
/// 提交失败就退回上一次存好的值，并把原因写在这一行下面——而不是让人去页面底部找。
///
/// 不用 `@State` / `@FocusState`：只装 Command Line Tools 时 SwiftUI 的宏插件不在，编不过；草稿状态在视图模型里，
/// 文本框的「失焦才提交」交给 AppKit 的 `NSTextField`（`controlTextDidEndEditing` 正好就是失焦或回车）。
struct PrefGroup<Content: View>: View {
    var title: String?
    let palette: Palette
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.textPrimary.color)
                    .padding(.horizontal, 4)
            }
            VStack(alignment: .leading, spacing: 0) { content() }
                .background(palette.surface.color)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(palette.border.color))
        }
    }
}

struct PrefRow<Control: View, Extra: View>: View {
    let title: String
    var description: String?
    var error: String?
    let palette: Palette
    @ViewBuilder var control: () -> Control
    @ViewBuilder var extra: () -> Extra

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(palette.textPrimary.color)
                    if let description {
                        Text(description).font(.system(size: 12)).foregroundStyle(palette.textTertiary.color)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) { control() }.fixedSize(horizontal: true, vertical: false)
            }
            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(palette.error.color).padding(.top, 6)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            extra().padding(.top, Extra.self == EmptyView.self ? 0 : 12)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(palette.border.color).frame(height: 1).opacity(0.5) }
    }
}

extension PrefRow where Extra == EmptyView {
    init(title: String, description: String? = nil, error: String? = nil, palette: Palette,
         @ViewBuilder control: @escaping () -> Control)
    {
        self.init(title: title, description: description, error: error, palette: palette, control: control) { EmptyView() }
    }
}

/// 没有右侧控件、内容占满整行的一行（列表、编辑器）。单独一个类型：与只有控件的 `PrefRow` 都是一个尾随闭包，同名会有歧义。
struct PrefBlock<Content: View>: View {
    let title: String
    var description: String?
    var error: String?
    let palette: Palette
    @ViewBuilder let content: () -> Content

    var body: some View {
        PrefRow(title: title, description: description, error: error, palette: palette, control: { EmptyView() },
                extra: content)
    }
}

extension PrefRow where Control == EmptyView, Extra == EmptyView {
    init(title: String, description: String? = nil, error: String? = nil, palette: Palette) {
        self.init(title: title, description: description, error: error, palette: palette, control: { EmptyView() }) {
            EmptyView()
        }
    }
}

/// 下拉框：选项是（值, 文字）。当前值不在选项里（手改过的配置）时显示为空，不擅自改掉它。
struct PrefPicker<Value: Hashable>: View {
    let label: String
    let value: Value
    let options: [(Value, String)]
    var width: CGFloat? = 180
    let onChange: (Value) -> Void

    var body: some View {
        Picker(label, selection: Binding(get: { value }, set: { if $0 != value { onChange($0) } })) {
            ForEach(options.indices, id: \.self) { index in
                Text(options[index].1).tag(options[index].0)
            }
        }
        .labelsHidden()
        .frame(width: width)
    }
}

/// 一行里的普通按钮。
struct PrefButton: View {
    let title: String
    var danger = false
    var prominent = false
    var disabled = false
    let palette: Palette
    let action: () -> Void

    var body: some View {
        if prominent {
            Button(action: action) { label }.buttonStyle(.borderedProminent).disabled(disabled)
        } else {
            Button(action: action) { label }.buttonStyle(.bordered).disabled(disabled)
        }
    }

    private var label: some View {
        Text(title).font(.system(size: 12)).foregroundStyle(danger ? palette.error.color : Color.primary)
    }
}

/// 右侧那种「›」或「↗」样式的跳转。
struct LinkRowButton: View {
    let label: String
    var external = false
    let palette: Palette
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(external ? "↗" : "›").font(.system(size: 14)).foregroundStyle(palette.textTertiary.color)
                .padding(.horizontal, 6).padding(.vertical, 2)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(label)
        .help(label)
    }
}

/// 文本草稿：边打边改本地值，失焦或回车才提交；提交失败退回 `value`。
/// 外部值变化（导入、回滚、别处写入）时同步草稿——但用户正在这个框里打字时不同步，否则一次迟到的保存失败回滚
/// 会把他刚敲的内容冲掉。
struct DraftField: NSViewRepresentable {
    let value: String
    var placeholder = ""
    var width: CGFloat = 220
    var secure = false
    var multiline = false
    var label: String?
    /// 返回保存任务（nil = 这次不提交，例如数字认不出来，草稿留着让用户改）。失败时草稿退回 `value`。
    let onCommit: (String) -> Task<Void, Error>?

    @MainActor final class Coordinator: NSObject, NSTextFieldDelegate, NSTextViewDelegate {
        var parent: DraftField
        /// 上次同步进框里的外部值：外部值没变时不重设，免得把用户的草稿盖掉。
        var shown: String?

        init(_ parent: DraftField) { self.parent = parent }

        func controlTextDidEndEditing(_ note: Notification) {
            guard let field = note.object as? NSTextField else { return }
            commit(field.stringValue) { field.stringValue = $0 }
        }

        func textDidEndEditing(_ note: Notification) {
            guard let view = note.object as? NSTextView else { return }
            commit(view.string) { view.string = $0 }
        }

        private func commit(_ next: String, revert: @escaping @MainActor (String) -> Void) {
            guard next != parent.value, let pending = parent.onCommit(next) else { return }
            Task { @MainActor in
                if (try? await pending.value) == nil {
                    revert(self.parent.value)
                    self.shown = self.parent.value
                }
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSView {
        if multiline {
            let scroll = NSTextView.scrollableTextView()
            scroll.hasVerticalScroller = true
            scroll.borderType = .bezelBorder
            let text = scroll.documentView as! NSTextView
            text.isRichText = false
            text.font = .systemFont(ofSize: 12)
            text.isAutomaticQuoteSubstitutionEnabled = false
            text.isAutomaticDashSubstitutionEnabled = false
            text.isAutomaticSpellingCorrectionEnabled = false
            text.isContinuousSpellCheckingEnabled = false
            text.delegate = context.coordinator
            text.setAccessibilityLabel(label)
            return scroll
        }
        let field = secure ? NSSecureTextField() : NSTextField()
        field.placeholderString = placeholder
        field.delegate = context.coordinator
        field.lineBreakMode = .byTruncatingTail
        field.usesSingleLineMode = true
        field.font = .systemFont(ofSize: 12)
        field.setAccessibilityLabel(label)
        return field
    }

    func updateNSView(_ view: NSView, context: Context) {
        context.coordinator.parent = self
        guard context.coordinator.shown != value else { return }
        if let field = view as? NSTextField {
            field.placeholderString = placeholder
            guard field.currentEditor() == nil else { return }
            field.stringValue = value
        } else if let scroll = view as? NSScrollView, let text = scroll.documentView as? NSTextView {
            guard text.window?.firstResponder !== text else { return }
            text.string = value
        }
        context.coordinator.shown = value
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView _: NSView, context _: Context) -> CGSize? {
        multiline ? CGSize(width: proposal.width ?? width, height: 88) : CGSize(width: width, height: 22)
    }
}

/// 多行编辑框（术语表的条目、预设的风格指令）：边打边写回视图模型，不是「失焦提交」的设置项。
/// 用 NSTextView 而不是 SwiftUI 的 TextEditor：要关掉智能引号——粘贴进来的 CSV 里的 `"` 被换成 `”` 就解析错了。
struct PlainTextEditor: NSViewRepresentable {
    let text: String
    var height: CGFloat = 120
    var monospaced = false
    var label: String?
    let onChange: (String) -> Void

    @MainActor final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: PlainTextEditor
        init(_ parent: PlainTextEditor) { self.parent = parent }

        func textDidChange(_ note: Notification) {
            guard let view = note.object as? NSTextView else { return }
            parent.onChange(view.string)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        let view = scroll.documentView as! NSTextView
        view.isRichText = false
        view.font = monospaced ? .monospacedSystemFont(ofSize: 12, weight: .regular) : .systemFont(ofSize: 12)
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.isAutomaticSpellingCorrectionEnabled = false
        view.isContinuousSpellCheckingEnabled = false
        view.delegate = context.coordinator
        view.string = text
        view.setAccessibilityLabel(label)
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let view = scroll.documentView as? NSTextView, view.string != text else { return }
        view.string = text
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView _: NSScrollView, context _: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 360, height: height)
    }
}

/// 键帽（快捷键的显示）。
struct Keycap: View {
    let text: String
    let palette: Palette

    var body: some View {
        Text(text).font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(palette.textPrimary.color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(palette.background.color)
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(palette.border.color))
    }
}

/// 确认对话框（Tauri 的 `window.confirm`）。
@MainActor
enum PrefConfirm {
    static func ask(_ message: String, confirm: String, cancel: String) -> Bool {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: confirm)
        alert.addButton(withTitle: cancel)
        alert.alertStyle = .warning
        return alert.runModal() == .alertFirstButtonReturn
    }
}
