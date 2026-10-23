import SwiftUI
import UmuoCore
import UniformTypeIdentifiers

/// 多模型对比窗的界面（PRD §5.6）：头部、卡片横排、空状态，
/// 文案与按钮的显示条件逐条一致。
///
/// 同一段文本并发发给最多 4 个模型，每张卡自己流式输出——谁先返回就先看到，这正是对比要回答的问题
/// （不只是「谁译得好」，还有「谁快」）。决策都在 `CompareSession` 里；不用 `@State`（只装 CLT 时编不过）。
struct CompareView: View {
    @Bindable var session: CompareSession

    private var p: Palette { session.palette }
    private var m: Palette.Metrics { session.metrics }
    private var t: Translate { session.t }

    var body: some View {
        VStack(spacing: 0) {
            header
            if session.state.cards.isEmpty { empty } else { cards }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(p.background.color)
        .environment(\.colorScheme, session.theme.colorScheme)
        .environment(\.metrics, m)
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.summary).font(.system(size: m.small)).foregroundStyle(p.textMuted.color)
                    .lineLimit(1).truncationMode(.tail)
                Text(session.sourceLine).font(.system(size: m.body)).foregroundStyle(p.textSecondary.color)
                    .lineLimit(1).truncationMode(.tail)
            }
            Spacer(minLength: 0)
            if let notice = session.actionNotice {
                Text(notice).font(.system(size: m.small)).foregroundStyle(p.error.color).lineLimit(1)
            }
            if session.showsReorderHint {
                Text(t("compare.reorderHint") + t("compare.reorderKeyboard"))
                    .font(.system(size: m.small)).foregroundStyle(p.textTertiary.color).lineLimit(1)
            }
            if let topPick = session.topPick {
                Text(topPick).font(.system(size: m.small)).foregroundStyle(p.textMuted.color).lineLimit(1)
            }
            PanelButton(t("compare.close"), size: m.small, color: p.textSecondary, palette: p, bordered: true) {
                session.hide()
            }
            .fixedSize()
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(p.border.color).frame(height: 1) }
    }

    private var empty: some View {
        VStack(spacing: 2) {
            ForEach(session.emptyLines, id: \.self) { line in
                Text(line).font(.system(size: m.body)).foregroundStyle(p.textTertiary.color)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: 448)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// 卡片平分宽度，最窄 240（`flex-1 min-w-[240px]`）；窗口放不下时整排横向滚动（`overflow-x-auto`）。
    private var cards: some View {
        GeometryReader { geometry in
            let cards = session.orderedCards
            let width = CompareLayout.cardWidth(available: geometry.size.width, count: cards.count)
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: CompareLayout.spacing) {
                    ForEach(Array(cards.enumerated()), id: \.element.index) { position, card in
                        CompareCardView(session: session, card: card, position: position, count: cards.count)
                            .frame(width: width)
                            .opacity(session.dragging == position ? 0.6 : 1)
                            // 拖拽包装在卡片外层：卡片只关心怎么显示，「卡片能被拖动」是这一排的编排
                            .onDrag {
                                session.beginDrag(at: position)
                                return CompareDrag.provider(cardIndex: card.index)
                            }
                            .onDrop(of: [CompareDrag.cardType], delegate: CardDrop(session: session, position: position))
                    }
                }
                .padding(CompareLayout.padding)
                .frame(height: geometry.size.height)
            }
            .onContinuousHover { phase in
                if case .active = phase { session.pointerMoved(buttonsPressed: NSEvent.pressedMouseButtons != 0) }
            }
        }
    }
}

/// 卡片横排的尺寸规则。纯函数，测得到。
enum CompareLayout {
    static let minCardWidth: CGFloat = 240
    static let spacing: CGFloat = 12
    static let padding: CGFloat = 12

    /// 可用宽度平分给每张卡片，但不窄于 240。
    static func cardWidth(available: CGFloat, count: Int) -> CGFloat {
        guard count > 0 else { return minCardWidth }
        let inner = available - padding * 2 - spacing * CGFloat(count - 1)
        return max(minCardWidth, (inner / CGFloat(count)).rounded(.down))
    }
}

/// 卡片拖拽的数据：只有本窗口产生的私有类型，别的应用拖来的文字、文件都不带它。
enum CompareDrag {
    static let cardType = UTType(exportedAs: "app.umuo.compare-card", conformingTo: .data)

    static func provider(cardIndex: UInt32) -> NSItemProvider {
        let provider = NSItemProvider()
        provider.registerDataRepresentation(forTypeIdentifier: cardType.identifier, visibility: .ownProcess) { done in
            done(Data("\(cardIndex)".utf8), nil)
            return nil
        }
        return provider
    }
}

/// 放下拖动的卡片：起点是拖动开始时记下的显示位置（同步记，不靠拖拽数据回来再解析——那要异步，拖得快就读到旧值）。
private struct CardDrop: DropDelegate {
    let session: CompareSession
    let position: Int

    /// 只接自己这一排拖出来的卡片：从别的应用拖来的文字不该让卡片换位置。
    func validateDrop(info: DropInfo) -> Bool {
        let carriesCard = info.hasItemsConforming(to: [CompareDrag.cardType])
        return MainActor.assumeIsolated { session.acceptsDrop(carriesCard: carriesCard) }
    }

    func performDrop(info: DropInfo) -> Bool {
        let carriesCard = info.hasItemsConforming(to: [CompareDrag.cardType])
        return MainActor.assumeIsolated {
            guard session.acceptsDrop(carriesCard: carriesCard) else { return false }
            return session.drop(at: position)
        }
    }
}

private struct CompareCardView: View {
    let session: CompareSession
    let card: CardState
    let position: Int
    let count: Int

    private var p: Palette { session.palette }
    private var t: Translate { session.t }
    @Environment(\.metrics) private var m

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView { content }
                .frame(maxHeight: .infinity)
            if let metrics = card.metricsLine(t) {
                footer { Text(metrics).font(.system(size: m.caption)).foregroundStyle(p.textMuted.color) }
            }
            if !card.text.isEmpty {
                footer {
                    PanelButton(t("compare.copyThis"), size: m.caption, color: p.textSecondary, palette: p,
                                bordered: true) { session.copy(card) }
                }
            }
        }
        .background(p.surface.color)
        .clipShape(RoundedRectangle(cornerRadius: m.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: m.cardRadius, style: .continuous).strokeBorder(p.border.color))
    }

    private var header: some View {
        HStack(spacing: 8) {
            (Text(card.provider).foregroundStyle(p.textPrimary.color)
                + Text(" " + card.model).foregroundStyle(p.textMuted.color))
                .font(.system(size: m.small, weight: .medium))
                .lineLimit(1).truncationMode(.tail)
                .help(card.model)
            Spacer(minLength: 0)
            // 显式的移动按钮：比隐藏的键盘快捷键更好——可发现、Tab 可达。拖拽仍是主要方式
            PanelButton("◀", size: m.caption, color: p.textSecondary, palette: p, bordered: true) {
                session.move(at: position, by: -1)
            }
            .accessibilityLabel(t("compare.moveLeft"))
            .disabled(position == 0)
            PanelButton("▶", size: m.caption, color: p.textSecondary, palette: p, bordered: true) {
                session.move(at: position, by: 1)
            }
            .accessibilityLabel(t("compare.moveRight"))
            .disabled(position >= count - 1)
            PanelButton(session.isPicked(card) ? t("compare.picked") : t("compare.pick"), size: m.caption,
                        color: session.isPicked(card) ? p.success : p.textSecondary, palette: p, bordered: true) {
                session.pick(card)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(p.borderSecondary.color).frame(height: 1) }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            if card.status == .waiting {
                Text(t("compare.waiting")).font(.system(size: m.body)).foregroundStyle(p.textTertiary.color)
            }
            if !card.text.isEmpty {
                Text(card.text).font(.system(size: m.body)).foregroundStyle(p.textPrimary.color)
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if card.status == .streaming, card.text.isEmpty {
                Text(t("compare.translating")).font(.system(size: m.body)).foregroundStyle(p.textTertiary.color)
            }
            if card.metrics?.truncated == true {
                Text(t("compare.truncated")).font(.system(size: m.caption)).foregroundStyle(p.warning.color)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = card.error {
                Text(error).font(.system(size: m.caption)).foregroundStyle(p.error.color)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 8).padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(p.errorSurface.color)
                    .clipShape(RoundedRectangle(cornerRadius: m.controlRadius / 2))
                    .overlay(RoundedRectangle(cornerRadius: m.controlRadius / 2).strokeBorder(p.errorBorder.color))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func footer(@ViewBuilder _ content: () -> some View) -> some View {
        HStack(spacing: 0) {
            content()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .overlay(alignment: .top) { Rectangle().fill(p.borderSecondary.color).frame(height: 1) }
    }
}
