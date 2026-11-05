import SwiftUI
import UmuoCore

/// 撰写窗的界面：上面是源 / 目标语言两个下拉，下面依次是状态行、输入框、译文区与底部按钮。
///
/// 它不做任何决策：调度、提交都在 `ComposeSession` 里（也因此能测）。不用 `@State`：只装 CLT 时编不过。
/// 控件用系统的；底板、圆角与阴影由窗口外壳负责（`FloatingPanelChrome`）。
struct ComposeView: View {
    @Bindable var session: ComposeSession

    private var t: Translate { session.t }
    private var state: PanelState { session.state }

    var body: some View {
        VStack(spacing: 0) {
            pickers
            header
            editor
            divider
            ScrollView { translation }
                .frame(minHeight: 112, maxHeight: .infinity)
            divider
            footer
        }
    }

    // MARK: - 源语言 / 目标语言（PRD §5.3）

    /// 放在头部上方而不是塞进头部：头部已经有开关与按钮。
    private var pickers: some View {
        HStack(spacing: 8) {
            picker($session.overrides.sourceLang, hint: t("compose.sourceLangHint"),
                   none: t("compose.autoDetect"), options: Languages.all.map { ($0.code, $0.label) })
            Image(systemName: "arrow.right").foregroundStyle(Color.secondary).accessibilityHidden(true)
            picker($session.overrides.targetLang, hint: t("compose.targetLangHint"),
                   none: t("compose.bySettings"), options: Languages.all.map { ($0.code, $0.label) })
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(WindowDragHandle())
        .overlay(alignment: .bottom) { divider }
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

    // MARK: - 状态行 + 自动翻译 + 收起

    private var header: some View {
        HStack(spacing: 8) {
            Text(state.statusLine(t).isEmpty ? t("compose.title") : state.statusLine(t))
                .font(.callout).foregroundStyle(Color.secondary)
                .lineLimit(1).truncationMode(.tail)
                .allowsHitTesting(false)
            Spacer(minLength: 0)
            Toggle(t("compose.autoTranslate"), isOn: $session.autoTranslate)
                .toggleStyle(.checkbox)
                .fixedSize()
            // 关掉自动翻译时的翻译入口（⌘T 同效，由窗口的按键监听处理）
            if !session.autoTranslate {
                PanelButton(t("compose.translate"), bordered: true) { session.translateNow() }
                    .disabled(session.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .help("\(t("compose.translate")) (⌘T)")
                    .fixedSize()
            }
            PanelButton(t("compose.close"), systemImage: "xmark") { session.escape() }
                .fixedSize()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(WindowDragHandle())
        .overlay(alignment: .bottom) { divider }
    }

    // MARK: - 输入框

    private var editor: some View {
        TextEditor(text: $session.input)
            .font(.body).foregroundStyle(Color.primary)
            .scrollContentBackground(.hidden)
            .autocorrectionDisabled()
            .accessibilityLabel(t("compose.placeholder"))
            .padding(.horizontal, 8).padding(.vertical, 6)
            .frame(minHeight: 112, maxHeight: .infinity)
            .overlay(alignment: .topLeading) {
                if session.input.isEmpty {
                    Text(t("compose.placeholder"))
                        .font(.body).foregroundStyle(Color.secondary)
                        .padding(.horizontal, 13).padding(.vertical, 6)
                        .allowsHitTesting(false)
                }
            }
    }

    // MARK: - 译文区

    private var translation: some View {
        VStack(alignment: .leading, spacing: 8) {
            if state.status == .streaming, state.translation.isEmpty {
                Text(t("compose.translating")).font(.body).foregroundStyle(Color.secondary)
            }
            // 撰写窗里打一个单词也会出词卡——它和划词走的是同一条判定规则
            if let card = state.card {
                WordCardView(card: card, t: t) { session.speak(card.word) }
            } else if !state.translation.isEmpty {
                Text(state.translation)
                    .font(.body).foregroundStyle(Color.primary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let warning = state.warning {
                NoticeLine(text: warning, systemImage: "exclamationmark.triangle.fill")
            }
            if state.status == .error { errorBlock(state.error ?? "") }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
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
        HStack(spacing: 4) {
            PanelButton(t("compose.copy"), prominent: true) {
                session.commit(paste: false)
            }
            .disabled(!session.settled)
            PanelButton(t("compose.copyPaste"), bordered: true) {
                session.commit(paste: true)
            }
            .disabled(!session.settled)
            Spacer(minLength: 8)
            if let notice = session.notice {
                Text(notice).font(.callout).foregroundStyle(Color.secondary)
                    .lineLimit(1).truncationMode(.tail)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private var divider: some View { Divider() }
}
