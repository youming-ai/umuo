import Testing
import UmuoCore
@testable import Umuo

// compare-state.test.ts 与 reorder.test.ts 逐条改写。

private let t = Translate(locale: .zhCN)

private let cards = [
    CardState(index: 0, providerId: "openai", provider: "OpenAI", model: "gpt-4o-mini"),
    CardState(index: 1, providerId: "deepseek", provider: "DeepSeek", model: "deepseek-chat"),
]

private func start(_ runId: UInt64 = 1) -> CompareAction {
    .start(runId: runId, text: "Hello world", targetLang: "中文", cards: cards)
}

private let done = CompareDone(runId: 1, index: 0, model: "gpt-4o-mini", totalMs: 1200, firstTokenMs: 400,
                               inputTokens: 100, outputTokens: 30, estimated: false, costUsd: 0.0001, truncated: false)

private func with<T>(_ value: T, _ change: (inout T) -> Void) -> T {
    var copy = value
    change(&copy)
    return copy
}

private func run(_ actions: CompareAction..., from state: CompareState = .initial) -> CompareState {
    actions.reduce(state) { $0.reduced($1) }
}

private func card(_ state: CompareState, _ index: UInt32) -> CardState {
    state.cards.first { $0.index == index }!
}

@Suite("对比窗状态机")
struct CompareReducerTests {
    @Test func start会重建全部卡片上一轮的译文不残留() {
        let state = run(start(), .delta(runId: 1, index: 0, text: "你"), start())
        #expect(card(state, 0).text == "")
        #expect(card(state, 0).status == .waiting)
        #expect(card(state, 1).status == .waiting)
        #expect(state.status == .running)
    }

    @Test func 增量只写进它自己那张卡() {
        let state = run(start(), .delta(runId: 1, index: 0, text: "你"), .delta(runId: 1, index: 1, text: "你"),
                        .delta(runId: 1, index: 0, text: "好"))
        #expect(card(state, 0).text == "你好")
        #expect(card(state, 1).text == "你")
    }

    @Test func 落定之后迟到的增量被丢掉() {
        let state = run(start(), .delta(runId: 1, index: 0, text: "你好"), .done(done))
        let settled = card(state, 0)
        #expect(card(state.reduced(.delta(runId: 1, index: 0, text: "世界")), 0) == settled)
    }

    @Test func 报错保留已经拿到的半段译文() {
        let state = run(start(), .delta(runId: 1, index: 0, text: "半段"), .error(runId: 1, index: 0, message: "限流"))
        #expect(card(state, 0).text == "半段")
        #expect(card(state, 0).status == .error)
        #expect(card(state, 0).error == "限流")
    }

    @Test func 一轮只有在全部卡片都落定之后才算结束() {
        let state = run(start(), .done(done))
        #expect(state.status == .running)
        #expect(state.reduced(.error(runId: 1, index: 1, message: "缺 Key")).status == .done)
    }

    @Test func 一张卡失败不影响另一张继续输出() {
        let state = run(start(), .error(runId: 1, index: 0, message: "boom"), .delta(runId: 1, index: 1, text: "照常"))
        #expect(card(state, 1).text == "照常")
        #expect(card(state, 1).status == .streaming)
    }

    @Test func reset回到初始状态() {
        let state = run(start(), .delta(runId: 1, index: 0, text: "x"))
        #expect(state.reduced(.reset) == with(CompareState.initial) { $0.runId = 1 })
    }
}

@Suite("卡片计量文案")
struct CardMetricsTests {
    @Test func 没有结果时不显示计量() {
        #expect(card(run(start()), 0).metricsLine(t) == nil)
    }

    @Test func 显示耗时token与费用() throws {
        let line = try #require(card(run(start(), .done(done)), 0).metricsLine(t))
        #expect(line.contains("首字 400ms"))
        #expect(line.contains("100 → 30 tokens"))
        #expect(line.contains("$0.0001"))
    }

    @Test func 价格未知时说无价格信息不编数字() throws {
        let line = try #require(card(run(start(), .done(with(done) { $0.costUsd = nil })), 0).metricsLine(t))
        #expect(line.contains("无价格信息"))
        #expect(!line.contains("$"))
    }

    @Test func 估算用量会明确标注() {
        #expect(card(run(start(), .done(with(done) { $0.estimated = true })), 0).metricsLine(t)?.contains("估算") == true)
    }
}

@Suite("按轮次过滤事件（审查 M1 / M17）")
struct RunIdTests {
    @Test func 上一轮迟到的增量完成与错误都被丢掉() {
        let fresh = run(start(), start(2))
        let state = run(.delta(runId: 1, index: 0, text: "旧"), .done(done), .error(runId: 1, index: 1, message: "已取消"),
                        from: fresh)
        #expect(state == fresh)
    }

    @Test func 比当前更旧的start被丢掉() {
        let state = run(start(2))
        #expect(state.reduced(start()) == state)
    }

    @Test func 整窗提示在没有卡片时也能显示出来() {
        let state = run(.notice(runId: 1, message: "没有选中文本"))
        #expect(state.notice == "没有选中文本")
        #expect(state.cards.isEmpty)
    }

    @Test func 新一轮的整窗提示清掉上一轮的卡片() {
        let state = run(start(), .delta(runId: 1, index: 0, text: "上一轮"), .notice(runId: 2, message: "没有可用于对比的模型"))
        #expect(state.cards.isEmpty)
        #expect(state.notice == "没有可用于对比的模型")
        #expect(state.runId == 2)
    }

    @Test func 下一轮start清掉提示() {
        #expect(run(.notice(runId: 1, message: "没有选中文本"), start(2)).notice == nil)
    }
}

@Suite("对比窗视图模型")
@MainActor
struct CompareModelTests {
    @Test func ffiEventsAreRoutedByRunAndIndexAndTheUserOrderSurvivesANewRun() {
        let model = CompareModel()
        let ffiCards = [
            CompareCard(index: 0, providerId: "openai", provider: "OpenAI", model: "a"),
            CompareCard(index: 1, providerId: "deepseek", provider: "DeepSeek", model: "b"),
        ]
        #expect(model.apply(CompareEvent.start(runId: 3, text: "x", targetLang: "中文", cards: ffiCards)))
        #expect(model.apply(CompareEvent.delta(runId: 3, index: 1, text: "乙")))
        #expect(!model.apply(CompareEvent.delta(runId: 2, index: 1, text: "旧")))
        #expect(model.apply(CompareEvent.done(runId: 3, index: 1, model: "b", totalMs: 1, firstTokenMs: nil, inputTokens: 1,
                                  outputTokens: 1, estimated: false, costUsd: nil, truncated: true)))
        #expect(card(model.state, 1).metrics?.truncated == true)
        model.move(from: 1, to: 0)
        #expect(model.orderedCards.map(\.index) == [1, 0])
        model.apply(CompareEvent.start(runId: 4, text: "y", targetLang: "中文", cards: ffiCards + [
            CompareCard(index: 2, providerId: "anthropic", provider: "Anthropic", model: "c"),
        ]))
        #expect(model.orderedCards.map(\.index) == [1, 0, 2])
    }
}

private struct Item: Indexed, Equatable {
    let index: UInt32
}

private func items(_ indexes: UInt32...) -> [Item] { indexes.map(Item.init) }

@Suite("移动一项")
struct MoveItemTests {
    @Test func 往前拖目标下标就是它该在的位置() {
        #expect(Reorder.move(["a", "b", "c", "d"], from: 3, to: 1) == ["a", "d", "b", "c"])
    }

    @Test func 往后拖也是放到那个位置不是跨过几个() {
        #expect(Reorder.move(["a", "b", "c", "d"], from: 0, to: 2) == ["b", "c", "a", "d"])
    }

    @Test func 拖到原位等于没动() {
        #expect(Reorder.move(["a", "b", "c"], from: 1, to: 1) == ["a", "b", "c"])
    }

    @Test func 越界的下标不改动任何东西() {
        let list = ["a", "b", "c"]
        #expect(Reorder.move(list, from: -1, to: 1) == list)
        #expect(Reorder.move(list, from: 3, to: 1) == list)
        #expect(Reorder.move(list, from: 0, to: 3) == list)
    }

    @Test func 移动不会丢项也不会重复() {
        let list = ["a", "b", "c", "d", "e"]
        for from in list.indices {
            for to in list.indices {
                #expect(Reorder.move(list, from: from, to: to).sorted() == list.sorted())
            }
        }
    }
}

@Suite("按用户顺序排列卡片")
struct ApplyOrderTests {
    @Test func 没有顺序偏好时保持原样() {
        #expect(Reorder.apply(items(0, 1, 2), order: []) == items(0, 1, 2))
    }

    @Test func 按给定的下标重排() {
        #expect(Reorder.apply(items(0, 1, 2), order: [2, 0, 1]).map(\.index) == [2, 0, 1])
    }

    @Test func 顺序里已经不存在的卡片被忽略() {
        #expect(Reorder.apply(items(0, 1), order: [2, 0, 1]).map(\.index) == [0, 1])
    }

    @Test func 新出现的卡片追加在后面而不是消失() {
        #expect(Reorder.apply(items(0, 1, 2), order: [1, 0]).map(\.index) == [1, 0, 2])
    }

    @Test func 顺序可以只覆盖一部分其余按原顺序补齐() {
        #expect(Reorder.apply(items(0, 1, 2, 3), order: [3, 1]).map(\.index) == [3, 1, 0, 2])
    }

    @Test func 不会丢卡也不会重复() {
        #expect(Reorder.apply(items(0, 1, 2, 3), order: [9, 3, 3, 1]).map(\.index) == [3, 1, 0, 2])
    }
}
