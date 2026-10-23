import SwiftUI
import UmuoCore

/// 划词翻译浮窗的界面：布局、文案、按钮的显示条件逐条一致。
///
/// 它不做任何决策——语言、模型、费用都来自 Engine 推来的事件；这里只把状态画出来，
/// 把「用户想干什么」交给 `PanelSession`。
///
/// 不用 `@State`：只装 Command Line Tools 时 SwiftUI 的宏插件不在，编不过；窗口状态全在 `PanelSession` 里（也因此能测）。
struct PanelView: View {
    @Bindable var session: PanelSession

    private var p: Palette { session.palette }
    private var m: Palette.Metrics { session.metrics }
    private var t: Translate { session.t }
    private var state: PanelState { session.state }

    var body: some View {
        VStack(spacing: 0) {
            header
            ViewThatFits(in: .vertical) {
                content
                ScrollView { content }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            if let warning = state.warning {
                // 翻译是成功的，只是结果来自另一个供应商。所以是提示而不是错误块。
                row { Text(warning).font(.system(size: m.caption)).foregroundStyle(p.warning.color) }
            }
            if session.hasContent {
                speakRow
                actionRow
            }
            if let notice = session.actionNotice {
                row { Text(notice).font(.system(size: m.caption)).foregroundStyle(p.textMuted.color) }
            }
            if let notice = state.replaceNotice(t) {
                row {
                    Text(notice).font(.system(size: m.small))
                        .foregroundStyle((state.replaced ? p.success : p.textTertiary).color)
                }
            }
            footer
        }
        .background(p.surface.color)
        .clipShape(RoundedRectangle(cornerRadius: m.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: m.cardRadius, style: .continuous)
            .strokeBorder(p.border.color))
        .environment(\.colorScheme, session.theme.colorScheme)
        .environment(\.metrics, m)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("panel.resultAria"))
    }

    // MARK: - header：状态行 + 复制 / 钉住 / 设置 / 收起

    private var header: some View {
        HStack(spacing: 8) {
            Text(state.statusLine(t))
                .font(.system(size: m.small)).foregroundStyle(p.textMuted.color)
                .lineLimit(1).truncationMode(.tail)
                .allowsHitTesting(false)
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                if session.canCopy {
                    PanelButton(t("panel.copy"), size: m.small, color: p.textSecondary, palette: p) {
                        session.copy()
                    }
                }
                PanelButton(session.pinned ? t("panel.pinned") : t("panel.pin"), size: m.small,
                            color: session.pinned ? p.success : p.textSecondary, palette: p) { session.togglePin() }
                    .help(t("panel.pinHint"))
                PanelButton(t("panel.settings"), size: m.small, color: p.textSecondary, palette: p) {
                    session.openSettings()
                }
                PanelButton(t("panel.collapse"), size: m.small, color: p.textSecondary, palette: p) {
                    session.backend?.hidePanel()
                }
                .accessibilityLabel(t("panel.collapseAria"))
            }
            .fixedSize()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        // 拖动区垫在底下：只有直接按在空白处才拖窗口，按钮照常可点
        .background(WindowDragHandle())
        .overlay(alignment: .bottom) { divider }
    }

    // MARK: - 正文：原文、译文或词卡、出错块

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !state.source.isEmpty {
                if session.editableSource { ocrEditor } else {
                    Text(state.source)
                        .font(.system(size: m.small)).foregroundStyle(p.textMuted.color)
                        .lineLimit(3).lineSpacing(2)
                        .textSelection(.enabled)
                }
            }
            if state.status == .streaming, state.translation.isEmpty {
                Text(t("panel.translating")).font(.system(size: m.body)).foregroundStyle(p.textTertiary.color)
            }
            if let card = state.card {
                WordCardView(card: card, palette: p, t: t) { session.speak(card.word) }
            } else if !state.translation.isEmpty {
                Text(state.translation)
                    .font(.system(size: m.body)).foregroundStyle(p.textPrimary.color)
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = session.errorText { errorBlock(error) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private var ocrEditor: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextEditor(text: $session.draft)
                .font(.system(size: m.small)).foregroundStyle(p.textSecondary.color)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 4).padding(.vertical, 2)
                .frame(minHeight: m(40), maxHeight: m(96))
                .background(p.background.color)
                .clipShape(RoundedRectangle(cornerRadius: m.controlRadius / 2))
                .overlay(RoundedRectangle(cornerRadius: m.controlRadius / 2).strokeBorder(p.border.color))
                .accessibilityLabel(t("panel.ocrEditAria"))
            HStack(spacing: 8) {
                Text(t("panel.ocrEditHint")).font(.system(size: m.caption)).foregroundStyle(p.textMuted.color)
                if session.canRetranslateDraft {
                    PanelButton(t("panel.retranslate"), size: m.caption, color: p.primary, palette: p,
                                bordered: true) { session.retranslateDraft() }
                }
            }
        }
    }

    private func errorBlock(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).font(.system(size: m.small)).foregroundStyle(p.error.color)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 4) {
                if state.needsPermission {
                    PanelButton(t("panel.actionOpenSystemSettings"), size: m.small, color: p.textPrimary,
                                palette: p, bordered: true) { session.openSystemSettings() }
                } else {
                    if state.errorActions.contains(.retry) {
                        PanelButton(t("panel.actionRetry"), size: m.small, color: p.textPrimary, palette: p,
                                    bordered: true) { session.retry() }
                    }
                    if session.offersModelSettings {
                        PanelButton(t("panel.actionOpenModelSettings"), size: m.small, color: p.textPrimary,
                                    palette: p, bordered: true) { session.openSettings() }
                    }
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(p.errorSurface.color)
        .clipShape(RoundedRectangle(cornerRadius: m.controlRadius / 2))
        .overlay(RoundedRectangle(cornerRadius: m.controlRadius / 2).strokeBorder(p.errorBorder.color))
    }

    // MARK: - 底部两行：朗读；替换 / 收藏 / 撰写 / 换模型 / 换风格

    private var speakRow: some View {
        row {
            HStack(spacing: 4) {
                if !state.source.isEmpty {
                    PanelButton(t("panel.speakSource"), size: m.caption, color: p.textSecondary, palette: p) {
                        session.speak(state.source)
                    }
                }
                if !state.translation.isEmpty {
                    PanelButton(t("panel.speakTranslation"), size: m.caption, color: p.textSecondary,
                                palette: p) { session.speak(state.translation) }
                }
                PanelButton(t("panel.stop"), size: m.caption, color: p.textSecondary, palette: p) {
                    session.stopSpeaking()
                }
            }
        }
    }

    private var actionRow: some View {
        row {
            HStack(spacing: 4) {
                if session.canReplace {
                    PanelButton(t("panel.replace"), size: m.caption, color: p.textSecondary, palette: p) {
                        session.replace()
                    }
                    .help(t("panel.replaceHint"))
                }
                PanelButton(session.favorited ? t("panel.favorited") : t("panel.favorite"), size: m.caption,
                            color: session.favorited ? p.success : p.textSecondary, palette: p) { session.toggleFavorite() }
                    .disabled(!session.canFavorite)
                PanelButton(t("panel.compose"), size: m.caption, color: p.textSecondary, palette: p) {
                    session.openCompose()
                }
                Spacer(minLength: 4)
                // 换模型 / 换风格是**动作**而不是当前状态的显示：浮窗不知道这次用的是哪家的 id（事件里只有显示名），
                // 与其显示一个可能是错的状态，不如只负责触发。
                Menu {
                    ForEach(session.providers, id: \.id) { provider in
                        Button(provider.label) { session.switchModel(provider) }
                    }
                } label: { menuLabel(t("panel.switchModel")) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .disabled(session.providers.isEmpty)
                Menu {
                    ForEach(session.styles, id: \.id) { style in
                        Button(style.label) { session.switchStyle(style.id) }
                    }
                } label: { menuLabel(t("panel.switchStyle")) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .disabled(session.styles.isEmpty)
            }
        }
    }

    private func menuLabel(_ text: String) -> some View {
        Text(text).font(.system(size: m.caption)).foregroundStyle(p.textSecondary.color)
    }

    private var footer: some View {
        HStack(spacing: 0) {
            if let metrics = costLine(state.metrics, t) {
                Text(metrics).font(.system(size: m.caption)).foregroundStyle(p.textMuted.color)
                    .lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 0)
            WindowResizeGrip(color: NSColor(p.textMuted.color)).frame(width: 12, height: 12)
        }
        .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 4)
        .overlay(alignment: .top) { if state.metrics != nil { divider } }
    }

    // MARK: - 小件

    private var divider: some View { Rectangle().fill(p.borderSecondary.color).frame(height: 1) }

    private func row(@ViewBuilder _ content: () -> some View) -> some View {
        HStack(spacing: 0) {
            content()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .overlay(alignment: .top) { divider }
    }
}

/// 浮窗里的小按钮（`.umuo-pressable rounded-control px-2 py-0.5`）；`bordered` 是出错块与重译用的描边款。
struct PanelButton: View {
    let title: String
    let size: CGFloat
    let color: Palette.RGBA
    let palette: Palette
    var bordered = false
    let action: () -> Void

    init(_ title: String, size: CGFloat, color: Palette.RGBA, palette: Palette, bordered: Bool = false,
         action: @escaping () -> Void)
    {
        self.title = title
        self.size = size
        self.color = color
        self.palette = palette
        self.bordered = bordered
        self.action = action
    }

    var body: some View {
        Button(action: action) { Text(title).font(.system(size: size)).lineLimit(1) }
            .buttonStyle(PressableStyle(color: color, palette: palette, bordered: bordered))
    }
}

private struct PressableStyle: ButtonStyle {
    let color: Palette.RGBA
    let palette: Palette
    let bordered: Bool
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.metrics) private var m

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: m.controlRadius / 2, style: .continuous)
        return configuration.label
            .foregroundStyle(color.color)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(configuration.isPressed ? palette.hover.color : .clear, in: shape)
            .overlay { if bordered { shape.strokeBorder(palette.border.color) } }
            .contentShape(shape)
            .opacity(isEnabled ? 1 : 0.5)
    }
}
