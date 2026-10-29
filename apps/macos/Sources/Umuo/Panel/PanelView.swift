import SwiftUI
import UmuoCore

/// 划词翻译浮窗的界面：布局、文案、按钮的显示条件逐条一致。
///
/// 它不做任何决策——语言、模型都来自 Engine 推来的事件；这里只把状态画出来，
/// 把「用户想干什么」交给 `PanelSession`。
///
/// 不用 `@State`：只装 Command Line Tools 时 SwiftUI 的宏插件不在，编不过；窗口状态全在 `PanelSession` 里（也因此能测）。
/// 控件、颜色与底板都用系统的：按钮是标准的小号按钮，底板与圆角、阴影由窗口外壳负责（`FloatingPanelChrome`）。
struct PanelView: View {
    @Bindable var session: PanelSession

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
            notices
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
            .padding(.horizontal, 12).padding(.bottom, 6)
        }
    }

    // MARK: - header：状态行 + 复制 / 钉住 / 设置 / 收起

    private var header: some View {
        HStack(spacing: 6) {
            Text(state.statusLine(t))
                .font(.callout).foregroundStyle(.secondary)
                .lineLimit(1).truncationMode(.tail)
                .allowsHitTesting(false)
            Spacer(minLength: 0)
            if session.canCopy {
                PanelButton(t("panel.copy"), systemImage: "doc.on.doc") { session.copy() }
            }
            PanelButton(session.pinned ? t("panel.pinned") : t("panel.pin"),
                        systemImage: session.pinned ? "pin.fill" : "pin",
                        tint: session.pinned ? .accentColor : nil) { session.togglePin() }
                .help(t("panel.pinHint"))
            PanelButton(t("panel.settings"), systemImage: "gearshape") { session.openSettings() }
            PanelButton(t("panel.collapseAria"), systemImage: "xmark") { session.backend?.hidePanel() }
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 4)
        // 拖动区垫在底下：只有直接按在空白处才拖窗口，按钮照常可点
        .background(WindowDragHandle())
    }

    // MARK: - 正文：原文、译文或词卡、出错块

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !state.source.isEmpty {
                if session.editableSource { ocrEditor } else { sourceText }
            }
            if state.status == .streaming, state.translation.isEmpty {
                Text(t("panel.translating")).font(.body).foregroundStyle(Color.secondary)
            }
            if let card = state.card {
                WordCardView(card: card, t: t) { session.speak(card.word) }
            } else if !state.translation.isEmpty {
                Text(state.translation)
                    .font(.body).foregroundStyle(Color.primary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = session.errorText { errorBlock(error) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    /// 只读原文：默认三行，放不下时给「展开原文 / 收起原文」。
    private var sourceText: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(state.source)
                .font(.callout).foregroundStyle(Color.secondary)
                .lineLimit(session.sourceExpanded ? nil : 3)
                .textSelection(.enabled)
                // 实测是否被截断：同宽下完整原文能装进这块高度就选第一个分支，否则落到第二个
                .background {
                    ViewThatFits(in: .vertical) {
                        Text(state.source).font(.callout).fixedSize(horizontal: false, vertical: true).hidden()
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
            HStack(spacing: 8) {
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

    // MARK: - 底部工具栏：朗读、替换、撰写；右边是计量

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
                .help(t("panel.speakTranslation"))
                if session.canReplace {
                    PanelButton(t("panel.replace"), systemImage: "arrow.left.arrow.right") { session.replace() }
                        .help(t("panel.replaceHint"))
                }
                PanelButton(t("panel.compose"), systemImage: "square.and.pencil") { session.openCompose() }
            }
            Spacer(minLength: 4)
            if let metrics = metricsLine(state.metrics, t) {
                Text(metrics).font(.caption).foregroundStyle(.tertiary)
                    .lineLimit(1).truncationMode(.middle)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .overlay(alignment: .top) { if session.hasContent || state.metrics != nil { Divider() } }
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

/// 浮窗里的按钮：系统的小号按钮。给了 `systemImage` 就只显示图标（文字作为悬停提示与读屏标签），
/// 否则是文字按钮（出错块里的「重试」等用带边框款）。`tint` 只给「已钉住」这类状态着色。
struct PanelButton: View {
    let title: String
    var systemImage: String?
    var tint: Color?
    var bordered = false
    var prominent = false
    let action: () -> Void

    init(_ title: String, systemImage: String? = nil, tint: Color? = nil, bordered: Bool = false,
         prominent: Bool = false, action: @escaping () -> Void)
    {
        self.title = title
        self.systemImage = systemImage
        self.tint = tint
        self.bordered = bordered
        self.prominent = prominent
        self.action = action
    }

    var body: some View {
        let button = Button(action: action) {
            if let systemImage {
                Label(title, systemImage: systemImage).labelStyle(.iconOnly).frame(width: 20, height: 18)
            } else {
                Text(title).lineLimit(1)
            }
        }
        .controlSize(.small).tint(tint)
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
