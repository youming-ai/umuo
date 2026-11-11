import AppKit
import SwiftUI

/// 设置窗的排版积木：系统的分组表单（`Form` + `.formStyle(.grouped)`，同 macOS 自带应用与 TablePro 的设置页）。
/// 一组是一个 `Section`；每行左边是名字，右边是控件。名字下面常显两种次要文字（同系统设置）：
/// 这一项做什么（`description`），以及此刻的状态（`note`：Key 是否已配置、当前引擎、导入结果）。
///
/// 所有控件都是「改了就存」：下拉框与开关立刻提交；文本框是草稿，失焦或回车才提交（`DraftField`），
/// 提交失败就退回上一次存好的值，并把原因写在这一行下面——而不是让人去页面底部找。
///
/// 不用 `@State` / `@FocusState`：只装 Command Line Tools 时 SwiftUI 的宏插件不在，编不过；草稿状态在视图模型里，
/// 文本框的「失焦才提交」交给 AppKit 的 `NSTextField`（`controlTextDidEndEditing` 正好就是失焦或回车）。
struct PrefGroup<Content: View>: View {
    var title: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        if let title {
            Section(title) { content() }
        } else {
            Section { content() }
        }
    }
}

struct PrefRow<Control: View, Extra: View>: View {
    let title: String
    /// 解释这一项做什么：常显在名字下面。
    var description: String?
    /// 此刻的状态：常显在名字下面。
    var note: String?
    var error: String?
    @ViewBuilder var control: () -> Control
    @ViewBuilder var extra: () -> Extra

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent {
                HStack(spacing: 8) { control() }.fixedSize(horizontal: true, vertical: false)
            } label: {
                Text(title)
                if let description { Text(description) }
                if let note { Text(note).textSelection(.enabled) }
            }
            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            extra()
        }
    }
}

extension PrefRow where Extra == EmptyView {
    init(title: String, description: String? = nil, note: String? = nil, error: String? = nil,
         @ViewBuilder control: @escaping () -> Control)
    {
        self.init(title: title, description: description, note: note, error: error, control: control) { EmptyView() }
    }
}

/// 没有右侧控件、内容占满整行的一行（列表、编辑器）。单独一个类型：与只有控件的 `PrefRow` 都是一个尾随闭包，同名会有歧义。
struct PrefBlock<Content: View>: View {
    let title: String
    var description: String?
    var error: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        PrefRow(title: title, description: description, error: error, control: { EmptyView() }, extra: content)
    }
}

extension PrefRow where Control == EmptyView, Extra == EmptyView {
    init(title: String, description: String? = nil, note: String? = nil, error: String? = nil) {
        self.init(title: title, description: description, note: note, error: error, control: { EmptyView() }) {
            EmptyView()
        }
    }
}

/// 下拉框：选项是（值, 文字）。当前值不在选项里（手改过的配置）时显示为空，不擅自改掉它。宽度随内容。
struct PrefPicker<Value: Hashable>: View {
    let label: String
    let value: Value
    let options: [(Value, String)]
    let onChange: (Value) -> Void

    var body: some View {
        Picker(label, selection: Binding(get: { value }, set: { if $0 != value { onChange($0) } })) {
            ForEach(options.indices, id: \.self) { index in
                Text(options[index].1).tag(options[index].0)
            }
        }
        .labelsHidden()
        .fixedSize()
    }
}

/// 一行里的普通按钮。系统按钮样式；危险操作用 `.destructive` 角色，由系统决定怎么标红。
struct PrefButton: View {
    let title: String
    var danger = false
    var prominent = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        let button = Button(title, role: danger ? .destructive : nil, action: action).disabled(disabled)
        if prominent {
            button.buttonStyle(.borderedProminent)
        } else {
            button
        }
    }
}

/// 文本草稿：边打边改本地值，失焦或回车才提交；提交失败退回 `value`。
/// 外部值变化（导入、回滚、别处写入）时同步草稿——但用户正在这个框里打字时不同步，否则一次迟到的保存失败回滚
/// 会把他刚敲的内容冲掉。
///
/// 给了 `suggestions` 就是系统的组合框（`NSComboBox`）：能手填，也能从下拉里挑一个候选，挑中即提交。
struct DraftField: NSViewRepresentable {
    let value: String
    var placeholder = ""
    var width: CGFloat = 240
    var secure = false
    var multiline = false
    var suggestions: [String]?
    var label: String?
    /// 返回保存任务（nil = 这次不提交，例如数字认不出来，草稿留着让用户改）。失败时草稿退回 `value`。
    let onCommit: (String) -> Task<Void, Error>?

    @MainActor final class Coordinator: NSObject, NSComboBoxDelegate, NSTextViewDelegate {
        var parent: DraftField
        /// 上次同步进框里的外部值：外部值没变时不重设，免得把用户的草稿盖掉。
        var shown: String?
        /// 用户继续编辑或再次提交后，旧保存的失败不再拥有这个草稿。
        private var editRevision = 0

        init(_ parent: DraftField) { self.parent = parent }

        func controlTextDidEndEditing(_ note: Notification) {
            guard let field = note.object as? NSTextField else { return }
            commit(field.stringValue, current: { field.stringValue },
                   editing: { field.currentEditor() != nil }) { field.stringValue = $0 }
        }

        func controlTextDidChange(_: Notification) { editRevision += 1 }
        func textDidChange(_: Notification) { editRevision += 1 }

        /// 从下拉里挑中：此时 `stringValue` 还是旧值，要读选中的那一项。
        func comboBoxSelectionDidChange(_ note: Notification) {
            guard let box = note.object as? NSComboBox, let picked = box.objectValueOfSelectedItem as? String else { return }
            box.stringValue = picked
            commit(picked, current: { box.stringValue },
                   editing: { box.currentEditor() != nil }) { box.stringValue = $0 }
        }

        func textDidEndEditing(_ note: Notification) {
            guard let view = note.object as? NSTextView else { return }
            commit(view.string, current: { view.string },
                   editing: { view.window?.firstResponder === view }) { view.string = $0 }
        }

        private func commit(_ next: String, current: @escaping @MainActor () -> String,
                            editing: @escaping @MainActor () -> Bool,
                            revert: @escaping @MainActor (String) -> Void) {
            guard next != parent.value, let pending = parent.onCommit(next) else { return }
            editRevision += 1
            let mine = editRevision
            Task { @MainActor in
                if (try? await pending.value) == nil {
                    guard self.editRevision == mine, current() == next, !editing() else { return }
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
            text.font = .systemFont(ofSize: NSFont.systemFontSize)
            text.isAutomaticQuoteSubstitutionEnabled = false
            text.isAutomaticDashSubstitutionEnabled = false
            text.isAutomaticSpellingCorrectionEnabled = false
            text.isContinuousSpellCheckingEnabled = false
            text.delegate = context.coordinator
            text.setAccessibilityLabel(label)
            return scroll
        }
        let field: NSTextField
        if let suggestions {
            let box = NSComboBox()
            box.completes = true
            box.numberOfVisibleItems = 12
            box.addItems(withObjectValues: suggestions)
            field = box
        } else {
            field = secure ? NSSecureTextField() : NSTextField()
            field.bezelStyle = .roundedBezel
        }
        field.placeholderString = placeholder
        field.delegate = context.coordinator
        field.lineBreakMode = .byTruncatingTail
        field.usesSingleLineMode = true
        field.font = .systemFont(ofSize: NSFont.systemFontSize)
        field.setAccessibilityLabel(label)
        return field
    }

    func updateNSView(_ view: NSView, context: Context) {
        let previous = context.coordinator.parent.suggestions
        context.coordinator.parent = self
        if let box = view as? NSComboBox, let suggestions, suggestions != previous {
            box.removeAllItems()
            box.addItems(withObjectValues: suggestions)
        }
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

    /// 单行框给一个起始宽度（地址、模型名够用），多行框占满整行。高度取控件自己的（组合框比文本框高）。
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSView, context _: Context) -> CGSize? {
        multiline ? CGSize(width: proposal.width ?? width, height: 88)
            : CGSize(width: width, height: nsView.intrinsicContentSize.height)
    }
}

/// 多行编辑框（OCR 结果窗里可改的原文）：边打边写回视图模型，不是「失焦提交」的设置项。
/// 用 NSTextView 而不是 SwiftUI 的 TextEditor：要关掉智能引号与自动替换——原文里的 `"` 被换成 `”` 就不是用户识别出的那段文字了。
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
        let size = NSFont.systemFontSize
        view.font = monospaced ? .monospacedSystemFont(ofSize: size, weight: .regular) : .systemFont(ofSize: size)
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
        // 输入法正在组字时不回写：浮窗里译文流式刷新会触发重绘，回写会把未上屏的拼音冲掉
        guard let view = scroll.documentView as? NSTextView, !view.hasMarkedText(), view.string != text else { return }
        view.string = text
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView _: NSScrollView, context _: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 360, height: height)
    }
}

/// 破坏性操作前的确认：系统警告框，以表单附在当前窗口上（没有窗口时才是独立对话框）。
/// 确认按钮标成破坏性；回车落在「取消」上，免得顺手一按就删了。
@MainActor
enum PrefConfirm {
    static func ask(_ message: String, detail: String? = nil, confirm: String, cancel: String) async -> Bool {
        let alert = NSAlert()
        alert.messageText = message
        if let detail { alert.informativeText = detail }
        alert.alertStyle = .warning
        let destructive = alert.addButton(withTitle: confirm)
        destructive.hasDestructiveAction = true
        destructive.keyEquivalent = ""
        alert.addButton(withTitle: cancel).keyEquivalent = "\r"
        // 刚关掉的打开面板之类的表单还可能是 key window：附到它的父窗口上，否则表单关闭时这里永远等不到结果。
        guard let window = NSApp.keyWindow.map({ $0.sheetParent ?? $0 }) else {
            return alert.runModal() == .alertFirstButtonReturn
        }
        return await withCheckedContinuation { done in
            alert.beginSheetModal(for: window) { done.resume(returning: $0 == .alertFirstButtonReturn) }
        }
    }
}
