import SwiftUI
import UmuoCore

/// 撰写窗的界面：上面是四个下拉，下面依次是状态行、输入框、译文区、
/// 回译区与底部按钮；文案与按钮的显示条件逐条一致。
///
/// 它不做任何决策：调度、提交、回译都在 `ComposeSession` 里（也因此能测）。不用 `@State`：只装 CLT 时编不过。
struct ComposeView: View {
    @Bindable var session: ComposeSession

    private var p: Palette { session.palette }
    private var m: Palette.Metrics { session.metrics }
    private var t: Translate { session.t }
    private var state: PanelState { session.state }
    private var back: PanelState { session.back.state }

    var body: some View {
        VStack(spacing: 0) {
            pickers
            header
            editor
            divider
            ScrollView { translation }
                .frame(minHeight: m(112), maxHeight: .infinity)
            if back.status != .idle {
                divider
                ScrollView { backArea }.frame(maxHeight: m(96))
            }
            divider
            footer
        }
        .background(p.surface.color)
        .clipShape(RoundedRectangle(cornerRadius: m.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: m.cardRadius, style: .continuous).strokeBorder(p.border.color))
        .environment(\.colorScheme, session.theme.colorScheme)
        .environment(\.metrics, m)
    }

    // MARK: - 语言 / 模型 / 风格（PRD §5.3）

    /// 放在头部上方而不是塞进头部：头部已经有开关与按钮，再挤四个下拉会看不清。
    private var pickers: some View {
        HStack(spacing: 8) {
            picker($session.overrides.sourceLang, hint: t("compose.sourceLangHint"),
                   none: t("compose.autoDetect"), options: Languages.all.map { ($0.code, $0.label) })
            Text("→").font(.system(size: m.caption)).foregroundStyle(p.textMuted.color)
            picker($session.overrides.targetLang, hint: t("compose.targetLangHint"),
                   none: t("compose.bySettings"), options: Languages.all.map { ($0.code, $0.label) })
            picker($session.overrides.providerId, hint: t("compose.providerHint"),
                   none: t("compose.defaultModel"), options: session.providers.map { ($0.id, $0.label) })
            picker($session.overrides.styleId, hint: t("compose.styleHint"),
                   none: t("compose.defaultStyle"), options: session.styles.map { ($0.id, $0.label) })
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
        .font(.system(size: m.caption))
        .fixedSize()
        .help(hint)
    }

    // MARK: - 状态行 + 自动翻译 + 收起

    private var header: some View {
        HStack(spacing: 8) {
            Text(state.statusLine(t).isEmpty ? t("compose.title") : state.statusLine(t))
                .font(.system(size: m.small)).foregroundStyle(p.textMuted.color)
                .lineLimit(1).truncationMode(.tail)
                .allowsHitTesting(false)
            Spacer(minLength: 0)
            Toggle(t("compose.autoTranslate"), isOn: $session.autoTranslate)
                .toggleStyle(.checkbox)
                .font(.system(size: m.small)).foregroundStyle(p.textSecondary.color)
                .fixedSize()
            PanelButton(t("compose.close"), size: m.small, color: p.textSecondary, palette: p) { session.escape() }
                .fixedSize()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(WindowDragHandle())
        .overlay(alignment: .bottom) { divider }
    }

    // MARK: - 输入框

    private var editor: some View {
        TextEditor(text: $session.input)
            .font(.system(size: m.body)).foregroundStyle(p.textPrimary.color)
            .scrollContentBackground(.hidden)
            .autocorrectionDisabled()
            .padding(.horizontal, 8).padding(.vertical, 6)
            .frame(minHeight: m(112), maxHeight: .infinity)
            .overlay(alignment: .topLeading) {
                if session.input.isEmpty {
                    Text(t("compose.placeholder"))
                        .font(.system(size: m.body)).foregroundStyle(p.textTertiary.color)
                        .padding(.horizontal, 13).padding(.vertical, 6)
                        .allowsHitTesting(false)
                }
            }
    }

    // MARK: - 译文区

    private var translation: some View {
        VStack(alignment: .leading, spacing: 8) {
            if state.status == .streaming, state.translation.isEmpty {
                Text(t("compose.translating")).font(.system(size: m.body)).foregroundStyle(p.textTertiary.color)
            }
            // 撰写窗里打一个单词也会出词卡——它和划词走的是同一条判定规则
            if let card = state.card {
                WordCardView(card: card, palette: p, t: t) { session.speak(card.word) }
            } else if !state.translation.isEmpty {
                Text(state.translation)
                    .font(.system(size: m.body)).foregroundStyle(p.textPrimary.color)
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if state.status == .error { errorBlock(state.error ?? "") }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func errorBlock(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).font(.system(size: m.caption)).foregroundStyle(p.error.color)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            PanelButton(t("compose.retry"), size: m.caption, color: p.textPrimary, palette: p, bordered: true) {
                session.retry()
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(p.errorSurface.color)
        .clipShape(RoundedRectangle(cornerRadius: m.controlRadius / 2))
        .overlay(RoundedRectangle(cornerRadius: m.controlRadius / 2).strokeBorder(p.errorBorder.color))
    }

    // MARK: - 回译区（单独一块，不覆盖主译文）

    private var backArea: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(t("compose.backTranslate")).font(.system(size: m.caption)).foregroundStyle(p.textMuted.color)
            if back.status == .streaming, back.translation.isEmpty {
                Text(t("compose.translating")).font(.system(size: m.caption)).foregroundStyle(p.textTertiary.color)
            }
            if !back.translation.isEmpty {
                Text(back.translation)
                    .font(.system(size: m.caption)).foregroundStyle(p.textSecondary.color)
                    .lineSpacing(2)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if back.status == .error, let error = back.error {
                Text(error).font(.system(size: m.caption)).foregroundStyle(p.error.color)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    // MARK: - 底部：复制 / 复制并粘贴 / 回译 + 提示

    private var footer: some View {
        HStack(spacing: 4) {
            PanelButton(t("compose.copy"), size: m.caption, color: p.textPrimary, palette: p, bordered: true) {
                session.commit(paste: false)
            }
            .disabled(!session.settled)
            PanelButton(t("compose.copyPaste"), size: m.caption, color: p.textPrimary, palette: p, bordered: true) {
                session.commit(paste: true)
            }
            .disabled(!session.settled)
            PanelButton(t("compose.backTranslate"), size: m.caption, color: p.textPrimary, palette: p,
                        bordered: true) { session.backTranslate() }
                .disabled(!session.canBackTranslate)
            Spacer(minLength: 8)
            if let notice = session.notice {
                Text(notice).font(.system(size: m.caption)).foregroundStyle(p.textMuted.color)
                    .lineLimit(1).truncationMode(.tail)
            }
            WindowResizeGrip(color: NSColor(p.textMuted.color)).frame(width: 12, height: 12)
        }
        .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 8)
    }

    private var divider: some View { Rectangle().fill(p.borderSecondary.color).frame(height: 1) }
}
