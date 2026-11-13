import SwiftUI
import UmuoCore

/// 翻译浮窗：原文、译文与操作分区，状态留在各自的内容区域。
/// 窗口行为由 AppKit 外壳负责，操作与请求归属仍由 `PanelSession` 决定。
struct PanelView: View {
    @Bindable var session: PanelSession

    private var t: Translate { session.t }
    private var state: PanelState { session.state }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    content
                    notices
                }
            }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: .infinity, alignment: .top)
                .readingSurface()
                .padding(.horizontal, 10)
            toolbar
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("panel.resultAria"))
    }

    /// 结果之外的几句话：可能不完整、操作结果、原文是否已被替换。翻译本身是成功的，所以是提示而不是错误块。
    /// 文字一律次要色，状态靠系统的多色符号区分（警告三角、完成对勾），不给文字本身染色。
    @ViewBuilder private var notices: some View {
        let lines: [(String, String?)] = [
            state.warning.map { ($0, "exclamationmark.triangle.fill") },
            session.actionNotice.map { ($0, nil) },
            state.replaceNotice(t).map { ($0, state.replaced ? "checkmark.circle.fill" : nil) },
        ].compactMap { $0 }
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(lines.indices, id: \.self) { index in
                    NoticeLine(text: lines[index].0, systemImage: lines[index].1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.bottom, 12)
        }
    }

    // MARK: - 顶栏：标题与窗口操作

    private var header: some View {
        HStack(spacing: 8) {
            Label(t("panel.title"), systemImage: "character.bubble")
                .font(.headline)
                .lineLimit(1)
                .allowsHitTesting(false)
            Spacer(minLength: 0)
            PanelButton(session.pinned ? t("panel.pinned") : t("panel.pin"),
                        systemImage: session.pinned ? "pin.fill" : "pin",
                        tint: session.pinned ? .accentColor : nil) { session.togglePin() }
                .help(t("panel.pinHint"))
            PanelButton(t("panel.settings"), systemImage: "gearshape") { session.openSettings() }
            PanelButton(t("panel.collapseAria"), systemImage: "xmark") { session.close() }
                .floatingControl("panel.close")
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        // 拖动区垫在底下：只有直接按在空白处才拖窗口，按钮照常可点
        .background(WindowDragHandle())
    }

    // MARK: - 正文：原文、译文或词卡、出错块

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !state.source.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    TranslationSectionTitle(title: t("panel.source"))
                    if session.editableSource { ocrEditor } else { sourceText }
                }
                .padding(16)
                Divider().padding(.horizontal, 16)
            }
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    TranslationSectionTitle(title: state.targetLang.isEmpty ? t("panel.translation") : Languages.label(state.targetLang))
                        .layoutPriority(1)
                    Spacer(minLength: 0)
                    if state.status == .streaming {
                        ProgressView().controlSize(.mini).accessibilityLabel(t("panel.translating"))
                    }
                    if !state.provider.isEmpty {
                        Text(state.provider).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            .help(state.statusLine(t))
                    }
                }
                if state.status == .streaming, state.translation.isEmpty {
                    Text(t("panel.translating")).font(.body).foregroundStyle(.secondary)
                }
                if let card = state.card {
                    WordCardView(card: card, t: t) { session.speak(card.word) }
                } else if !state.translation.isEmpty {
                    Text(state.translation)
                        .font(.body).foregroundStyle(.primary)
                        .lineSpacing(5)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let error = session.errorText { errorBlock(error) }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 只读原文：默认三行，放不下时给「展开原文 / 收起原文」。
    private var sourceText: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(state.source)
                .font(.callout).foregroundStyle(Color.primary)
                .lineSpacing(3)
                .lineLimit(session.sourceExpanded ? nil : 3)
                .textSelection(.enabled)
                // 实测是否被截断：同宽下完整原文能装进这块高度就选第一个分支，否则落到第二个
                .background {
                    ViewThatFits(in: .vertical) {
                        Text(state.source).font(.callout).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true).hidden()
                            .onAppear { session.sourceTruncated = false }
                        Color.clear.onAppear { session.sourceTruncated = true }
                    }
                }
            if session.sourceTruncated || session.sourceExpanded {
                Button(session.sourceExpanded ? t("panel.collapseSource") : t("panel.expandSource")) {
                    session.sourceExpanded.toggle()
                }
                .buttonStyle(.link).font(.callout)
            }
        }
    }

    private var ocrEditor: some View {
        VStack(alignment: .leading, spacing: 4) {
            // 系统文本视图（带边框的 NSTextView），与设置里的多行输入同一个控件；可编辑的文字用主色
            PlainTextEditor(text: session.draft, height: 64, label: t("panel.ocrEditAria")) { session.draft = $0 }
            VStack(alignment: .leading, spacing: 8) {
                Text(t("panel.ocrEditHint")).font(.callout).foregroundStyle(Color.secondary)
                if session.canRetranslateDraft {
                    PanelButton(t("panel.retranslate"), prominent: true) { session.retranslateDraft() }
                }
            }
        }
    }

    /// 出错：系统的警告符号加正文色文字，下面是可做的操作；不垫彩色底板。
    private func errorBlock(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ErrorLine(message: message)
            HStack(spacing: 4) {
                if state.needsPermission {
                    PanelButton(t("panel.actionOpenSystemSettings"), bordered: true) { session.openSystemSettings() }
                } else {
                    if state.errorActions.contains(.retry) {
                        PanelButton(t("panel.actionRetry"), bordered: true) { session.retry() }
                    }
                    if session.offersModelSettings {
                        PanelButton(t("panel.actionOpenModelSettings"), bordered: true) { session.openSettings() }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - 底部工具栏：内容操作与复制；计量收在详情提示里

    private var toolbar: some View {
        HStack(spacing: 6) {
            if session.hasContent {
                // 点按直接朗读译文，旁边的小箭头展开「朗读原文 / 停止」：系统的分体菜单按钮
                Menu {
                    if !state.source.isEmpty {
                        Button(t("panel.speakSource")) { session.speak(state.source) }
                    }
                    if !state.translation.isEmpty {
                        Button(t("panel.speakTranslation")) { session.speak(state.translation) }
                    }
                    Divider()
                    Button(t("panel.stop")) { session.stopSpeaking() }
                } label: {
                    Label(t("panel.speakTranslation"), systemImage: "speaker.wave.2")
                } primaryAction: {
                    if !state.translation.isEmpty { session.speak(state.translation) } else { session.speak(state.source) }
                }
                .menuStyle(.borderlessButton).labelStyle(.iconOnly).fixedSize()
                .frame(minWidth: 28, minHeight: 28)
                .help(t("panel.speakTranslation"))
                if session.canReplace {
                    PanelButton(t("panel.replace"), systemImage: "arrow.left.arrow.right") { session.replace() }
                        .help(t("panel.replaceHint"))
                }
                PanelButton(t("panel.compose"), systemImage: "square.and.pencil") { session.openCompose() }
            }
            Spacer(minLength: 4)
            if let metrics = metricsLine(state.metrics, t) {
                Image(systemName: "info.circle")
                    .foregroundStyle(.secondary)
                    .help(metrics)
                    .accessibilityLabel(metrics)
            }
            if session.canCopy {
                PanelButton(t("panel.copy"), systemImage: "doc.on.doc", iconOnly: false, prominent: true) { session.copy() }
                    .floatingControl("panel.copy")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .floatingControl("panel.actions")
    }
}

/// 浮窗里的一行提示：可选的系统多色符号 + 次要色文字。
struct NoticeLine: View {
    let text: String
    let systemImage: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage).symbolRenderingMode(.multicolor).accessibilityHidden(true)
            }
            Text(text).foregroundStyle(Color.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.callout)
    }
}

/// 出错的那一行：红色警告符号 + 正文色、可选中的错误说明（浮窗与撰写窗共用）。
struct ErrorLine: View {
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.red).accessibilityHidden(true)
            Text(message).foregroundStyle(Color.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.callout)
    }
}

/// 浮窗里的按钮：使用系统按钮样式与控件尺寸。给了 `systemImage` 就只显示图标（文字作为悬停提示与读屏标签），
/// 否则是文字按钮（出错块里的「重试」等用带边框款）。`tint` 只给「已钉住」这类状态着色。
struct PanelButton: View {
    let title: String
    var systemImage: String?
    var iconOnly = true
    var tint: Color?
    var bordered = false
    var prominent = false
    let action: () -> Void

    init(_ title: String, systemImage: String? = nil, iconOnly: Bool = true, tint: Color? = nil, bordered: Bool = false,
         prominent: Bool = false, action: @escaping () -> Void)
    {
        self.title = title
        self.systemImage = systemImage
        self.iconOnly = iconOnly
        self.tint = tint
        self.bordered = bordered
        self.prominent = prominent
        self.action = action
    }

    var body: some View {
        let button = Button(action: action) {
            if let systemImage, iconOnly {
                Label(title, systemImage: systemImage).labelStyle(.iconOnly)
                    .frame(width: 28, height: 28).contentShape(Rectangle())
            } else if let systemImage {
                Label(title, systemImage: systemImage).lineLimit(1).fixedSize()
            } else {
                Text(title).lineLimit(1)
            }
        }
        .controlSize(.regular).tint(tint)
        .help(systemImage == nil ? "" : title)
        if prominent {
            button.buttonStyle(.borderedProminent)
        } else if bordered {
            button.buttonStyle(.bordered)
        } else {
            button.buttonStyle(.borderless).foregroundStyle(tint ?? .secondary)
        }
    }
}

/// 原文与译文的分区标题：使用系统文字层级，供两个翻译窗口共用。
struct TranslationSectionTitle: View {
    let title: String

    var body: some View {
        Text(title).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            .lineLimit(1)
            .accessibilityAddTraits(.isHeader)
    }
}
