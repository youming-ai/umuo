import Foundation
import Observation
import UmuoCore

/// 对比窗往外要做的事。正式实现是 `CompareController`（Engine 与剪贴板一律在后台调），测试换成只记调用的假实现。
@MainActor
protocol CompareBackend: AnyObject {
    /// Esc：只取消对比窗自己这一轮（最多 4 路一起停），浮窗与撰写窗的翻译不受影响。
    func cancelCompare()
    func hideCompare()
    /// 记一次「选它」，返回更新后的完整排行。
    func recordPick(providerId: String, model: String) async throws -> [ComparePick]
    /// 复制到剪贴板。失败返回给用户看的话。
    func copy(_ text: String) async -> String?
}

/// 对比窗的视图模型（PRD §5.6）：卡片状态（`CompareModel`）之外，窗口自己的那些状态——偏好排行、这一轮选了哪张、
/// 空状态里的快捷键。`apps/desktop/src/compare.tsx` 里 `useState` 的那几项，语义逐条一致。
@MainActor @Observable
final class CompareSession {
    let model = CompareModel()
    var state: CompareState { model.state }
    var orderedCards: [CardState] { model.orderedCards }

    /// 「选它」的排行（多的在前）。
    var picks: [ComparePick] = []
    /// 这一轮被选为最佳的那张：`providerId:model`。新一轮开始（start / notice）时清掉。
    var picked: String?
    /// 空状态提示里的对比快捷键（已排成键帽文字）。读不到设置就不提。
    var compareKeys: String?
    /// 复制失败这类一次性提示。
    var actionNotice: String?
    var theme: ResolvedTheme = .dark
    var locale: AppLocale = .source
    var scale: Double = 1
    var metrics: Palette.Metrics { Palette.Metrics(scale: scale) }
    var t: Translate { Translate(locale: locale) }
    var palette: Palette { .of(theme) }

    weak var backend: CompareBackend?

    init(backend: CompareBackend? = nil) {
        self.backend = backend
    }

    // MARK: - 事件

    /// Engine 推来的事件（或界面自己发的 notice）。被当作过期事件丢掉时返回 false。
    @discardableResult
    func apply(_ action: CompareAction) -> Bool {
        guard model.apply(action) else { return false }
        switch action {
        case .start, .notice, .reset:
            picked = nil
            actionNotice = nil
            // 上一轮没收尾的拖动（拖到窗口外取消）不带进新一轮：记下的显示位置可能已是另一张卡
            dragging = nil
        case .delta, .done, .error:
            break
        }
        return true
    }

    @discardableResult
    func apply(_ event: CompareEvent) -> Bool { apply(CompareAction(event)) }

    // MARK: - 显示

    /// 头部第一行：有卡片时说「几个模型 · 目标语言」。
    var summary: String {
        state.cards.isEmpty
            ? t("compare.title")
            : t("compare.summary", ["count": "\(state.cards.count)", "lang": state.targetLang])
    }

    var sourceLine: String { state.source.isEmpty ? t("compare.waitingSelection") : state.source }

    /// 没有卡片时的说明：先说怎么触发（读得到快捷键时），再说为什么没有结果（整窗提示，或「还要两把 Key」）。
    var emptyLines: [String] {
        var lines: [String] = []
        if let compareKeys { lines.append(t("compare.emptyHint", ["keys": compareKeys])) }
        lines.append(state.notice ?? t("compare.needTwoKeys"))
        return lines
    }

    var topPick: String? {
        guard let first = picks.first else { return nil }
        return t("compare.topPick", ["provider": first.providerId, "model": first.model, "count": "\(first.count)"])
    }

    /// 只有一张卡片时不提示排序。
    var showsReorderHint: Bool { state.cards.count > 1 }

    static func pickKey(_ card: CardState) -> String { "\(card.providerId):\(card.model)" }

    func isPicked(_ card: CardState) -> Bool { picked == Self.pickKey(card) }

    // MARK: - 操作

    /// 先取消再收起：对比窗背后是最多 4 路并发的真实计费请求，只把窗口藏起来的话，
    /// 用户会继续为一个自己看不见的结果付费。
    func escape() {
        dragging = nil
        backend?.cancelCompare()
        backend?.hideCompare()
    }

    /// 「收起」按钮：与 Tauri 一样只收起（结果会照常流完，下次唤出还在）。
    func hide() {
        dragging = nil
        backend?.hideCompare()
    }

    func pick(_ card: CardState) {
        let key = Self.pickKey(card)
        Task {
            guard let backend else { return }
            do {
                picks = try await backend.recordPick(providerId: card.providerId, model: card.model)
                picked = key
            } catch {
                actionNotice = userMessage(error)
            }
        }
    }

    /// 显示位置 `position` 的卡片往左（-1）或往右（+1）挪一格。以**当前显示顺序**为基准：
    /// 用户看到的顺序才是他点按钮时的预期。越界时什么都不变。
    func move(at position: Int, by offset: Int) {
        model.move(from: position, to: position + offset)
    }

    /// 正在被拖的那张卡片的显示位置（拖动中的视觉反馈，也是放下时的起点）。
    ///
    /// SwiftUI 的 `onDrag` 没有「拖动结束」回调（Tauri 靠 `onDragEnd` 清 `dragFrom`），拖到窗口外或按 Esc 取消时
    /// 这里不会被放下清掉。所以：能不能放下另看拖拽数据是不是本窗卡片（`acceptsDrop`），残留的位置在新一轮、
    /// 收起 / 唤出、以及鼠标松开后再回到卡片上时清掉（`pointerMoved`）。
    private(set) var dragging: Int?

    func beginDrag(at position: Int) { dragging = position }

    /// 能不能放下：只接这一排自己拖出来的卡片——拖拽数据得带卡片专用类型（`CompareDrag.cardType`，别的应用
    /// 产生不了），且确有一次拖动在进行。只看 `dragging` 不够：取消的拖动会把它留下，别的应用拖来的文字就被当成卡片。
    func acceptsDrop(carriesCard: Bool) -> Bool { carriesCard && dragging != nil }

    /// 鼠标在卡片区移动。拖动进行时系统不发移动事件；按键都松开了还记着拖动，说明那次拖动已经取消，清掉残留的半透明。
    func pointerMoved(buttonsPressed: Bool) {
        if !buttonsPressed, dragging != nil { dragging = nil }
    }

    /// 放到显示位置 `position` 上。返回有没有挪动。
    @discardableResult
    func drop(at position: Int) -> Bool {
        defer { dragging = nil }
        guard let from = dragging, from != position else { return false }
        model.move(from: from, to: position)
        return true
    }

    func endDrag() { dragging = nil }

    func copy(_ card: CardState) {
        let text = card.text
        guard !text.isEmpty else { return }
        Task {
            if let failure = await backend?.copy(text) { actionNotice = failure }
        }
    }
}
