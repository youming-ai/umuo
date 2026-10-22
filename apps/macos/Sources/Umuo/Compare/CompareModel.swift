import Foundation
import Observation
import UmuoCore

// 对比窗的状态机，`apps/desktop/src/lib/compare-state.ts` 的移植，语义逐条一致。
//
// 与浮窗那套的区别：这里是 **N 路并发**的流式输出，每条增量都带卡片下标。抽成纯函数同样是为了测那些
// 在界面里几乎无法复现的时序问题：某张卡已经报错了、它的增量却还在路上；或者一轮结束后又来了一批旧增量。
// 验收用例在 Tests/UmuoTests/CompareStateTests.swift。

enum CardStatus: Equatable, Sendable { case waiting, streaming, done, error }

/// 一张卡片的完成计量。
struct CompareDone: Equatable {
    var runId: UInt64
    var index: UInt32
    var model: String
    var totalMs: UInt64
    var firstTokenMs: UInt64?
    var inputTokens: UInt32
    var outputTokens: UInt32
    var estimated: Bool
    var costUsd: Double?
    var truncated: Bool
}

struct CardState: Equatable, Indexed {
    var index: UInt32
    var providerId: String
    var provider: String
    var model: String
    var text = ""
    var status: CardStatus = .waiting
    var error: String?
    var metrics: CompareDone?

    /// 卡片标题行的计量文案：`latency · tokens · cost`。价格未知时明确说「无价格信息」，不编数字。
    func metricsLine(_ t: Translate) -> String? {
        guard let metrics else { return nil }
        return [
            MetricsText.latency(firstTokenMs: metrics.firstTokenMs, totalMs: metrics.totalMs, t),
            MetricsText.tokens(metrics.inputTokens, metrics.outputTokens, estimated: metrics.estimated, t),
            MetricsText.cost(metrics.costUsd, t),
        ].joined(separator: " · ")
    }
}

enum CompareStatus: Equatable, Sendable {
    /// 还没发起过。
    case idle
    /// 还有卡片没落定。
    case running
    case done
}

enum CompareAction: Equatable {
    case start(runId: UInt64, text: String, targetLang: String, cards: [CardState])
    case delta(runId: UInt64, index: UInt32, text: String)
    case done(CompareDone)
    case error(runId: UInt64, index: UInt32, message: String)
    case notice(runId: UInt64, message: String)
    case reset

    init(_ event: CompareEvent) {
        switch event {
        case let .start(runId, text, targetLang, cards):
            self = .start(runId: runId, text: text, targetLang: targetLang, cards: cards.map {
                CardState(index: $0.index, providerId: $0.providerId, provider: $0.provider, model: $0.model)
            })
        case let .delta(runId, index, text):
            self = .delta(runId: runId, index: index, text: text)
        case let .done(runId, index, model, totalMs, firstTokenMs, inputTokens, outputTokens, estimated, costUsd, truncated):
            self = .done(CompareDone(runId: runId, index: index, model: model, totalMs: totalMs, firstTokenMs: firstTokenMs,
                                     inputTokens: inputTokens, outputTokens: outputTokens, estimated: estimated,
                                     costUsd: costUsd, truncated: truncated))
        case let .error(runId, index, message):
            self = .error(runId: runId, index: index, message: message)
        case let .notice(runId, message):
            self = .notice(runId: runId, message: message)
        }
    }
}

struct CompareState: Equatable {
    var status: CompareStatus = .idle
    /// 正在显示的那一轮。0 = 还没有过（后端的 id 从 1 起）。别的轮次的事件一律丢掉。
    var runId: UInt64 = 0
    /// 整窗级的提示（没有可用模型、取词失败）。新一轮 start 时清掉。
    var notice: String?
    var source = ""
    var targetLang = ""
    var cards: [CardState] = []

    static let initial = CompareState()

    func reduced(_ action: CompareAction) -> CompareState {
        switch action {
        case let .start(runId, text, targetLang, cards):
            // 比当前还旧的一轮：它在发出 start 前就已经被新一轮顶掉了。
            if runId < self.runId { return self }
            // 每次 start 整体重建：上一轮的译文绝不能残留在这一轮的卡片里。
            return CompareState(status: .running, runId: runId, notice: nil, source: text, targetLang: targetLang,
                                cards: cards.map { card in
                                    var fresh = card
                                    fresh.text = ""
                                    fresh.status = .waiting
                                    fresh.error = nil
                                    fresh.metrics = nil
                                    return fresh
                                })

        case let .delta(runId, index, text):
            // 上一轮迟到的增量：同一个下标在新一轮里是另一张卡片，写进去就串了。
            guard runId == self.runId else { return self }
            return updating { card in
                guard card.index == index else { return }
                // 已经落定的卡片不再接受增量：迟到的分片如果还写进去，用户会看到译文在「完成」之后又长出一截。
                if card.status == .done || card.status == .error { return }
                card.status = .streaming
                card.text += text
            }

        case let .done(done):
            guard done.runId == runId else { return self }
            return updating { card in
                guard card.index == done.index else { return }
                card.status = .done
                card.metrics = done
            }

        case let .error(runId, index, message):
            guard runId == self.runId else { return self }
            return updating { card in
                guard card.index == index else { return }
                // 已经出过译文的卡片只在下面补一条错误说明，不要把译文清掉——半段译文对用户仍有价值。
                card.status = .error
                card.error = message
            }

        case let .notice(runId, message):
            if runId < self.runId { return self }
            // 新一轮在出卡片之前就失败了：上一轮的卡片不能留着，否则看起来像是这一轮的结果。
            var next = CompareState.initial
            next.runId = runId
            next.notice = message
            return next

        case .reset:
            var next = CompareState.initial
            next.runId = runId
            return next
        }
    }

    private func updating(_ change: (inout CardState) -> Void) -> CompareState {
        var next = self
        for i in next.cards.indices { change(&next.cards[i]) }
        next.status = Self.settle(next.cards)
        return next
    }

    /// 全部卡片都落定（done 或 error）时，整轮才算结束。
    private static func settle(_ cards: [CardState]) -> CompareStatus {
        if cards.isEmpty { return .idle }
        return cards.allSatisfy { $0.status == .done || $0.status == .error } ? .done : .running
    }
}

/// 对比窗的视图模型：持有状态，按 `runId` 丢弃旧轮次的事件；卡片顺序（用户拖出来的）单独记，
/// 显示时经 `Reorder.apply` 排——数据变了不用同步一份顺序，那是最容易出闪烁与错位的地方。
@MainActor @Observable
final class CompareModel {
    private(set) var state = CompareState.initial
    /// 用户拖出来的卡片下标顺序。
    var order: [UInt32] = []

    var orderedCards: [CardState] { Reorder.apply(state.cards, order: order) }

    /// 返回状态有没有变（被当作过期事件丢掉时为 false）。
    @discardableResult
    func apply(_ action: CompareAction) -> Bool {
        let next = state.reduced(action)
        guard next != state else { return false }
        state = next
        return true
    }

    @discardableResult
    func apply(_ event: CompareEvent) -> Bool { apply(CompareAction(event)) }

    /// 把显示位置 `from` 的卡片挪到 `to`。
    func move(from: Int, to: Int) {
        order = Reorder.move(orderedCards.map(\.index), from: from, to: to)
    }
}
