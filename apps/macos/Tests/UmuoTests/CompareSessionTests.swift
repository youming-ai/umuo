import Testing
import UmuoCore
@testable import Umuo

// 对比窗视图模型的交互规则（`apps/desktop/src/compare.tsx` 里的按钮与状态）。backend 换成只记调用的假实现。

@MainActor
private final class FakeBackend: CompareBackend {
    var cancelled = 0
    var hidden = 0
    var picks: [(String, String)] = []
    var pickResult: Result<[ComparePick], EngineError> = .success([ComparePick(providerId: "openai",
                                                                               model: "gpt-4o-mini", count: 3)])
    var copied: [String] = []
    var copyFailure: String?

    func cancelCompare() { cancelled += 1 }
    func hideCompare() { hidden += 1 }
    func recordPick(providerId: String, model: String) async throws -> [ComparePick] {
        picks.append((providerId, model))
        return try pickResult.get()
    }

    func copy(_ text: String) async -> String? {
        copied.append(text)
        return copyFailure
    }
}

private let cards = [
    CardState(index: 0, providerId: "openai", provider: "OpenAI", model: "gpt-4o-mini"),
    CardState(index: 1, providerId: "deepseek", provider: "DeepSeek", model: "deepseek-chat"),
    CardState(index: 2, providerId: "anthropic", provider: "Anthropic", model: "claude"),
]

private func start(_ runId: UInt64) -> CompareAction {
    .start(runId: runId, text: "Hello world", targetLang: "中文", cards: cards)
}

private func settle() async {
    for _ in 0 ..< 20 { await Task.yield() }
    try? await Task.sleep(for: .milliseconds(20))
}

/// 等到条件成立（最多约 2 秒）。并行跑测试时主线程忙，固定让出几次不一定够。
@MainActor
private func until(_ condition: () -> Bool) async {
    for _ in 0 ..< 200 where !condition() {
        try? await Task.sleep(for: .milliseconds(10))
    }
}

@MainActor
private func session() -> (CompareSession, FakeBackend) {
    let backend = FakeBackend()
    let session = CompareSession(backend: backend)
    session.locale = .zhCN
    return (session, backend)
}

@Suite("对比窗视图模型")
@MainActor
struct CompareSessionTests {
    @Test func Esc先取消这一轮再收起_收起按钮只收起() {
        let (session, backend) = session()
        session.escape()
        #expect(backend.cancelled == 1 && backend.hidden == 1)
        session.hide()
        #expect(backend.cancelled == 1 && backend.hidden == 2)
    }

    @Test func 选它记一次偏好并标出这一张() async throws {
        let (session, backend) = session()
        session.apply(start(1))
        let card = try #require(session.orderedCards.first)
        session.pick(card)
        await until { session.picked != nil }
        #expect(backend.picks.map(\.0) == ["openai"])
        #expect(session.isPicked(card))
        #expect(!session.isPicked(session.orderedCards[1]))
        #expect(session.topPick == "最常选：openai · gpt-4o-mini（3 次）")
    }

    @Test func 新一轮与整窗提示清掉上一轮选的那张() async throws {
        let (session, backend) = session()
        defer { withExtendedLifetime(backend) {} }
        session.apply(start(1))
        session.pick(try #require(session.orderedCards.first))
        await until { session.picked != nil }
        // 比当前更旧的一轮被丢掉，不动选择
        #expect(!session.apply(start(0)))
        #expect(session.picked != nil)
        session.apply(start(2))
        #expect(session.picked == nil)
        session.pick(session.orderedCards[0])
        await until { session.picked != nil }
        session.apply(CompareAction.notice(runId: 3, message: "没有可用于对比的模型"))
        #expect(session.picked == nil)
    }

    @Test func 记偏好失败时说出原因() async throws {
        let (session, backend) = session()
        backend.pickResult = .failure(.Failed(message: "未知供应商"))
        session.apply(start(1))
        session.pick(try #require(session.orderedCards.first))
        await until { session.actionNotice != nil }
        #expect(session.picked == nil)
        #expect(session.actionNotice == "未知供应商")
    }

    @Test func 左右移动以当前显示顺序为准_越界不动() {
        let (session, backend) = session()
        defer { withExtendedLifetime(backend) {} }
        session.apply(start(1))
        session.move(at: 0, by: 1)
        #expect(session.orderedCards.map(\.index) == [1, 0, 2])
        session.move(at: 1, by: 1)
        #expect(session.orderedCards.map(\.index) == [1, 2, 0])
        session.move(at: 0, by: -1)
        session.move(at: 2, by: 1)
        #expect(session.orderedCards.map(\.index) == [1, 2, 0])
    }

    @Test func 拖到别的位置才挪_放回原处不算() {
        let (session, backend) = session()
        defer { withExtendedLifetime(backend) {} }
        session.apply(start(1))
        session.beginDrag(at: 0)
        #expect(session.dragging == 0)
        #expect(session.drop(at: 2))
        #expect(session.dragging == nil)
        #expect(session.orderedCards.map(\.index) == [1, 2, 0])
        session.beginDrag(at: 1)
        #expect(!session.drop(at: 1))
        // 没有在拖时放下什么都不做
        #expect(!session.drop(at: 0))
        #expect(session.orderedCards.map(\.index) == [1, 2, 0])
    }

    @Test func 取消的拖动之后_别的应用拖来的文字不换位置() {
        let (session, backend) = session()
        defer { withExtendedLifetime(backend) {} }
        session.apply(start(1))
        session.beginDrag(at: 0)
        // 拖到窗口外取消：没有放下，dragging 还在
        #expect(!session.acceptsDrop(carriesCard: false))
        #expect(session.acceptsDrop(carriesCard: true))
        // 鼠标还按着（拖动中）不清；松开后回到卡片上才清掉残留
        session.pointerMoved(buttonsPressed: true)
        #expect(session.dragging == 0)
        session.pointerMoved(buttonsPressed: false)
        #expect(session.dragging == nil)
        #expect(!session.acceptsDrop(carriesCard: true))
        #expect(session.orderedCards.map(\.index) == [0, 1, 2])
    }

    @Test func 残留的拖动在新一轮_收起与Esc时清掉() {
        let (session, backend) = session()
        defer { withExtendedLifetime(backend) {} }
        session.apply(start(1))
        session.beginDrag(at: 1)
        session.apply(start(2))
        #expect(session.dragging == nil)
        session.beginDrag(at: 1)
        session.apply(CompareAction.notice(runId: 3, message: "m"))
        #expect(session.dragging == nil)
        session.beginDrag(at: 1)
        session.hide()
        #expect(session.dragging == nil)
        session.beginDrag(at: 1)
        session.escape()
        #expect(session.dragging == nil)
    }

    @Test func 用户排好的顺序在下一轮保留() {
        let (session, backend) = session()
        defer { withExtendedLifetime(backend) {} }
        session.apply(start(1))
        session.move(at: 0, by: 1)
        session.apply(start(2))
        #expect(session.orderedCards.map(\.index) == [1, 0, 2])
    }

    @Test func 空状态先说怎么触发再说为什么没结果() {
        let (session, backend) = session()
        defer { withExtendedLifetime(backend) {} }
        #expect(session.emptyLines == ["还需要在设置里为至少两个供应商填好 API Key。"])
        session.compareKeys = "⌥P"
        session.apply(CompareAction.notice(runId: 1, message: "没有选中文本"))
        #expect(session.emptyLines == ["选中一段文字后按 ⌥P，同一段内容会同时发给多个模型。", "没有选中文本"])
        #expect(session.summary == "多模型对比")
        #expect(session.sourceLine == "等待选中文本…")
    }

    @Test func 有卡片时头部说几个模型与目标语言() {
        let (session, backend) = session()
        defer { withExtendedLifetime(backend) {} }
        session.apply(start(1))
        #expect(session.summary == "3 个模型 · 目标语言 中文")
        #expect(session.sourceLine == "Hello world")
        #expect(session.showsReorderHint)
    }

    @Test func 复制这一版_失败时说出来() async {
        let (session, backend) = session()
        session.apply(start(1))
        session.apply(CompareAction.delta(runId: 1, index: 1, text: "你好世界"))
        backend.copyFailure = "复制失败：剪贴板不可用：写入失败"
        session.copy(session.orderedCards[1])
        // 没有译文的卡片不复制
        session.copy(session.orderedCards[0])
        await until { session.actionNotice != nil }
        #expect(backend.copied == ["你好世界"])
        #expect(session.actionNotice == "复制失败：剪贴板不可用：写入失败")
    }

    @Test func 卡片平分宽度但不窄于240() {
        // 1000 宽 4 张：(1000 - 24 - 36) / 4 = 235，比 240 窄，取 240（整排横向滚动）
        #expect(CompareLayout.cardWidth(available: 1000, count: 4) == 240)
        #expect(CompareLayout.cardWidth(available: 1000, count: 2) == 482)
        #expect(CompareLayout.cardWidth(available: 640, count: 4) == 240)
        #expect(CompareLayout.cardWidth(available: 640, count: 0) == 240)
    }

    @Test func 空状态的快捷键来自设置() {
        #expect(CompareController.compareKeys(settingsJson: #"{"compareHotkey":"Alt+P"}"#)
            == HotkeyFormat.parts("Alt+P").joined())
        #expect(CompareController.compareKeys(settingsJson: #"{"compareHotkey":""}"#) == nil)
        #expect(CompareController.compareKeys(settingsJson: nil) == nil)
    }
}
