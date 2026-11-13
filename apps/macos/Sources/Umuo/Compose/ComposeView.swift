import SwiftUI
import UmuoCore

/// 输入翻译：单行语言工具栏、输入区、译文区与提交栏。
/// 内容调度与提交守卫仍由 `ComposeSession` 负责。
struct ComposeView: View {
    @Bindable var session: ComposeSession

    private var t: Translate { session.t }
    private var state: PanelState { session.state }

    var body: some View {
        VStack(spacing: 0) {
            pickers
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    TranslationSectionTitle(title: t("panel.source")).padding(.horizontal, 16).padding(.top, 12)
                    editor
                }
                .frame(minHeight: 100, maxHeight: .infinity)
                Divider().padding(.horizontal, 16)
                ScrollView { translation }
                    .scrollBounceBehavior(.basedOnSize)
                    .frame(minHeight: 80, maxHeight: .infinity)
            }
            .readingSurface()
            .padding(.horizontal, 10)
            footer
        }
    }

    // MARK: - 源语言 / 目标语言（PRD §5.3）

    /// 语言选择与窗口关闭同排，翻译选项留在底部操作栏。
    private var pickers: some View {
        HStack(spacing: 8) {
            picker($session.overrides.sourceLang, hint: t("compose.sourceLangHint"),
                   none: t("compose.autoDetect"), options: Languages.all.map { ($0.code, $0.label) })
            Image(systemName: "arrow.right").foregroundStyle(Color.secondary).accessibilityHidden(true)
            picker($session.overrides.targetLang, hint: t("compose.targetLangHint"),
                   none: t("compose.bySettings"), options: Languages.all.map { ($0.code, $0.label) })
            Spacer(minLength: 0)
            PanelButton(t("compose.close"), systemImage: "xmark") { session.escape() }
                .accessibilityIdentifier("compose.close")
                .anchorPreference(key: FloatingControlBounds.self, value: .bounds) { ["compose.close": $0] }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(WindowDragHandle())
    }

    private func picker(_ selection: Binding<String>, hint: String, none: String,
                        options: [(String, String)]) -> some View
    {
        Picker(hint, selection: selection) {
            Text(none).tag("")
            ForEach(options, id: \.0) { option in Text(option.1).tag(option.0) }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .controlSize(.small)
        .font(.subheadline)
        .fixedSize()
        .help(hint)
    }

    // MARK: - 输入框

    private var editor: some View {
        TextEditor(text: $session.input)
            .font(.body).foregroundStyle(Color.primary)
            .scrollContentBackground(.hidden)
            .autocorrectionDisabled()
            .accessibilityLabel(t("compose.placeholder"))
            .padding(.horizontal, 12).padding(.bottom, 12)
            .frame(minHeight: 80, maxHeight: .infinity)
            .overlay(alignment: .topLeading) {
                if session.input.isEmpty {
                    Text(t("compose.placeholder"))
                        .font(.body).foregroundStyle(Color.secondary)
                        .padding(.horizontal, 17).padding(.top, 0)
                        .allowsHitTesting(false)
                }
            }
    }

    // MARK: - 译文区

    private var translation: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let notice = session.notice {
                NoticeLine(text: notice, systemImage: nil)
                    .textSelection(.enabled)
            }
            HStack(spacing: 8) {
                TranslationSectionTitle(title: state.targetLang.isEmpty ? t("panel.translation") : Languages.label(state.targetLang))
                Spacer(minLength: 0)
                if state.status == .streaming {
                    ProgressView().controlSize(.mini).accessibilityLabel(t("compose.translating"))
                }
                if !state.provider.isEmpty {
                    Text(state.provider).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        .help(state.statusLine(t))
                }
            }
            if state.status == .idle {
                Text(t("compose.emptyResult")).font(.callout).foregroundStyle(.tertiary)
            }
            if state.status == .streaming, state.translation.isEmpty {
                Text(t("compose.translating")).font(.body).foregroundStyle(Color.secondary)
            }
            // 撰写窗里打一个单词也会出词卡——它和划词走的是同一条判定规则
            if let card = state.card {
                WordCardView(card: card, t: t) { session.speak(card.word) }
            } else if !state.translation.isEmpty {
                Text(state.translation)
                    .font(.body).foregroundStyle(Color.primary)
                    .lineSpacing(5)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let warning = state.warning {
                NoticeLine(text: warning, systemImage: "exclamationmark.triangle.fill")
            }
            if state.status == .error { errorBlock(state.error ?? "") }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    private func errorBlock(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ErrorLine(message: message)
            PanelButton(t("compose.retry"), bordered: true) {
                session.retry()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - 底部：复制 / 复制并粘贴 + 提示

    /// 「复制」是 ⌘↩ 对应的默认操作，用系统的强调按钮；⌘↩ 由窗口的按键监听处理（输入法组字时不误触），这里不再挂快捷键。
    private var footer: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                translationOptions
                Spacer(minLength: 12)
                submitActions
            }
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    translationOptions
                    Spacer(minLength: 0)
                }
                HStack {
                    Spacer(minLength: 0)
                    submitActions
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    @ViewBuilder private var translationOptions: some View {
        Toggle(t("compose.autoTranslate"), isOn: $session.autoTranslate)
            .toggleStyle(.checkbox).font(.callout).fixedSize()
        if !session.autoTranslate {
            PanelButton(t("compose.translate"), bordered: true) { session.translateNow() }
                .accessibilityIdentifier("compose.translate")
                .anchorPreference(key: FloatingControlBounds.self, value: .bounds) { ["compose.translate": $0] }
                .disabled(session.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .help("\(t("compose.translate")) (⌘T)")
        }
    }

    private var submitActions: some View {
        HStack(spacing: 8) {
            PanelButton(t("compose.copyPaste"), bordered: true) { session.commit(paste: true) }
                .accessibilityIdentifier("compose.copyPaste")
                .anchorPreference(key: FloatingControlBounds.self, value: .bounds) { ["compose.copyPaste": $0] }
                .disabled(!session.settled)
                .help("\(t("compose.copyPaste")) (⌘⇧↵)")
            PanelButton(t("compose.copy"), systemImage: "doc.on.doc", iconOnly: false, prominent: true) { session.commit(paste: false) }
                .accessibilityIdentifier("compose.copy")
                .anchorPreference(key: FloatingControlBounds.self, value: .bounds) { ["compose.copy": $0] }
                .disabled(!session.settled)
                .help("\(t("compose.copy")) (⌘↵)")
        }
        .fixedSize()
    }
}
