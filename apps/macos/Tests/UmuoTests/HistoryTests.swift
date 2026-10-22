import Foundation
import Testing
import UmuoCore
@testable import Umuo

// history-format.test.ts 逐条改写，外加历史窗视图模型的规则（三个条件一起送后端、防抖、失败要说清楚、
// 收藏状态逐行对上、清空先确认、再次编辑不带浮窗归属）。假 backend 只记调用：不碰真实历史库与剪贴板。

/// 断言的是简体中文文案，与源语言一致。
private let t = Translate(locale: .zhCN)

private let record = HistoryRecord(
    id: 1, createdAt: 1_700_000_000, sourceText: "Hello", translatedText: "你好", sourceLang: "en", targetLang: "zh-CN",
    providerId: "openai", model: "gpt-4o-mini", styleId: "standard", scene: "selection", sourceApp: "Safari",
    inputTokens: 100, outputTokens: 40, estimated: false, costUsd: 0.0001
)

private func with(_ change: (inout HistoryRecord) -> Void) -> HistoryRecord {
    var copy = record
    change(&copy)
    return copy
}

private func day(_ d: String, _ count: UInt32, cost: Double = 0.001, unpriced: UInt32 = 0) -> DayUsage {
    DayUsage(day: d, count: count, inputTokens: count * 10, outputTokens: count * 4, costUsd: cost, unpriced: unpriced)
}

@Suite("历史：场景标签")
struct HistorySceneTests {
    @Test func 把内部场景键翻成用户看得懂的中文() {
        #expect(HistoryFormat.sceneLabel("selection", t) == "划词")
        #expect(HistoryFormat.sceneLabel("silentReplace", t) == "原地替换")
        #expect(HistoryFormat.sceneLabel("compose", t) == "撰写窗")
        #expect(HistoryFormat.sceneLabel("compare", t) == "对比")
    }

    @Test func 未知场景原样显示而不是显示未知() {
        #expect(HistoryFormat.sceneLabel("somethingNew", t) == "somethingNew")
    }
}

@Suite("历史：时间与元信息")
struct HistoryMetaTests {
    @Test func 按本地时间输出到分钟() throws {
        // 用本地日历构造，避免测试受运行机器时区影响
        let date = try #require(Calendar.current.date(from: DateComponents(year: 2026, month: 5, day: 6, hour: 9, minute: 5)))
        #expect(HistoryFormat.timestamp(Int64(date.timeIntervalSince1970)) == "2026-05-06 09:05")
    }

    @Test func 包含模型场景token与费用() {
        let meta = HistoryFormat.recordMeta(record, t)
        #expect(meta.contains("openai · gpt-4o-mini"))
        #expect(meta.contains("划词"))
        #expect(meta.contains("100 → 40 tokens"))
        #expect(meta.contains("$0.0001"))
        #expect(meta.contains("Safari"))
    }

    @Test func 价格未知时说未计价不显示零美元() {
        // 显示 $0.0000 会让人以为这次翻译是免费的
        let meta = HistoryFormat.recordMeta(with { $0.costUsd = nil }, t)
        #expect(meta.contains("未计价"))
        #expect(!meta.contains("$"))
    }

    @Test func 用量是估算时明确标注() {
        #expect(HistoryFormat.recordMeta(with { $0.estimated = true }, t).contains("估算"))
    }

    @Test func 拿不到来源应用时整个略过() {
        for app in [nil, ""] as [String?] {
            let meta = HistoryFormat.recordMeta(with { $0.sourceApp = app }, t)
            #expect(meta.components(separatedBy: " · ").last?.isEmpty == false)
            #expect(meta.hasSuffix("$0.0001"))
        }
    }
}

@Suite("历史：本月用量")
struct HistoryUsageTests {
    let usage = UsageSummary(count: 12, inputTokens: 1200, outputTokens: 400, costUsd: 0.0123, unpriced: 0)

    @Test func 还没读到数据时给出等待文案() {
        #expect(HistoryFormat.usageLine(nil, t).contains("正在读取"))
    }

    @Test func 显示次数token与费用() {
        let line = HistoryFormat.usageLine(usage, t)
        #expect(line.contains("本月 12 次"))
        #expect(line.contains("1200 → 400 tokens"))
        #expect(line.contains("$0.0123"))
    }

    @Test func 有未计价条目时必须如实说出条数() {
        var partial = usage
        partial.unpriced = 3
        #expect(HistoryFormat.usageLine(partial, t).contains("另有 3 条未计价"))
    }

    @Test func 没有未计价条目时不加那句尾巴() {
        #expect(!HistoryFormat.usageLine(usage, t).contains("未计价"))
    }
}

@Suite("历史：按日柱状图")
struct HistoryBarsTests {
    @Test func 按日期升序排列() {
        let bars = HistoryFormat.dailyBars([day("2026-10-05", 2), day("2026-10-03", 1), day("2026-10-04", 3)])
        #expect(bars.map(\.day) == ["2026-10-03", "2026-10-04", "2026-10-05"])
    }

    @Test func 比例以窗口内最大值为基准() {
        let bars = HistoryFormat.dailyBars([day("2026-10-01", 5), day("2026-10-02", 10)])
        #expect(abs(bars[0].ratio - 0.5) < 1e-9)
        #expect(bars[1].ratio == 1)
    }

    @Test func 全为零时不会除零() {
        let bars = HistoryFormat.dailyBars([day("2026-10-01", 0), day("2026-10-02", 0)])
        #expect(bars.allSatisfy { $0.ratio.isFinite && $0.ratio == 0 })
        // 柱子最矮 2pt：次数极少那天也留一条基线
        #expect(HistoryFormat.barHeight(0) == 2)
        #expect(HistoryFormat.barHeight(1) == 36)
    }

    @Test func 只保留最近N天而不是最早的N天() {
        let many = (1 ... 30).map { day(String(format: "2026-09-%02d", $0), UInt32($0)) }
        let bars = HistoryFormat.dailyBars(many, limit: 14)
        #expect(bars.count == 14)
        #expect(bars.last?.count == 30)
    }

    @Test func 标签只取月日() {
        #expect(HistoryFormat.dailyBars([day("2026-10-06", 1)])[0].label == "10-06")
    }

    @Test func 悬浮说明带日期次数费用并标明未计价() {
        let title = HistoryFormat.dayBarTitle(HistoryFormat.dailyBars([day("2026-10-06", 3, cost: 0.0021, unpriced: 2)])[0], t)
        #expect(title.contains("2026-10-06"))
        #expect(title.contains("3 次"))
        #expect(title.contains("2 条未计价"))
    }
}

@Suite("历史：收藏")
struct HistoryFavoriteFormatTests {
    let base = Favorite(id: 1, createdAt: 0, kind: "word", text: "hello", translation: "你好", sourceLang: nil,
                        targetLang: "zh-CN")

    @Test func 区分单词与句子() {
        var sentence = base
        sentence.kind = "sentence"
        #expect(HistoryFormat.favoriteMeta(base, t) == "单词 · zh-CN")
        #expect(HistoryFormat.favoriteMeta(sentence, t) == "句子 · zh-CN")
    }

    @Test func 复制时空串译文退回原文() {
        // 旧版本可能存过空串译文（审查 L23）
        var empty = base
        empty.translation = ""
        #expect(HistoryFormat.favoriteCopyText(empty) == "hello")
        empty.translation = nil
        #expect(HistoryFormat.favoriteCopyText(empty) == "hello")
        #expect(HistoryFormat.favoriteCopyText(base) == "你好")
    }

    @Test func 分页标题有收藏时带条数() {
        #expect(HistoryFormat.favoritesTab(count: 0, t) == "收藏")
        #expect(HistoryFormat.favoritesTab(count: 3, t) == "收藏 3")
    }

    @Test func 空列表区分没搜到与没记录() {
        #expect(HistoryFormat.emptyText(query: "  ", t) == t("history.emptyNoRecords"))
        #expect(HistoryFormat.emptyText(query: "foo", t) == t("history.emptyNoMatch"))
    }
}

// MARK: - 视图模型

private struct Broken: Error, CustomStringConvertible {
    var description: String { "数据库坏了" }
}

@MainActor
private final class FakeHistory: HistoryBackend {
    var rows = [record]
    var starred: Set<String> = []
    var filters: [HistoryFilter] = []
    var fail = false
    var confirm = true
    var confirmed: [String] = []
    var deleted: [Int64] = []
    var cleared = 0
    var copied: [String] = []
    var composed: [(String, String)] = []
    var favs: [Favorite] = []
    var privacy = false

    func query(_ filter: HistoryFilter, limit _: UInt32) async throws -> [HistoryRecord] {
        filters.append(filter)
        if fail { throw Broken() }
        return rows
    }

    func favoritesStatus(_ texts: [String]) async throws -> [Bool] { texts.map(starred.contains) }
    func usageSummary() async throws -> UsageSummary {
        UsageSummary(count: UInt32(rows.count), inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0)
    }

    func usageDaily(days _: UInt32) async throws -> [DayUsage] { [day("2026-10-01", 1)] }
    func favorites(limit _: UInt32) async throws -> [Favorite] { favs }
    func facets() async throws -> HistoryFacets { HistoryFacets(apps: ["Safari"], models: ["gpt-4o-mini"]) }
    func privacyMode() async throws -> Bool { privacy }

    func favoriteToggle(text: String, translation _: String?) async throws -> Bool {
        if starred.remove(text) != nil { return false }
        starred.insert(text)
        return true
    }

    func favoriteRemove(id: Int64) async throws { favs.removeAll { $0.id == id } }
    func delete(id: Int64) async throws {
        deleted.append(id)
        rows.removeAll { $0.id == id }
    }

    func clear() async throws -> UInt32 {
        cleared += 1
        defer { rows = [] }
        return UInt32(rows.count)
    }

    func confirmClear(_ message: String, confirm _: String, cancel _: String) -> Bool {
        confirmed.append(message)
        return confirm
    }

    func copy(_ text: String) async -> String? {
        copied.append(text)
        return nil
    }

    func openCompose(text: String, translation: String) throws { composed.append((text, translation)) }
}

/// 防抖的等待换成「什么都不等」：测的是「改了就重查、三个条件一起送」，不是计时器。
private let instant: @Sendable (Duration) async throws -> Void = { _ in }

@MainActor
@Suite("历史窗视图模型")
struct HistoryModelTests {
    @Test func 载入后列表收藏状态用量与筛选候选都到位() async {
        let backend = FakeHistory()
        backend.starred = ["Hello"]
        let model = HistoryModel(backend: backend, sleep: instant)
        model.t = t
        await model.reload()
        #expect(model.records.map(\.id) == [1])
        #expect(model.favorited == [true])
        #expect(model.usage?.count == 1)
        #expect(model.bars.count == 1)
        #expect(model.facets.apps == ["Safari"])
        #expect(model.status == nil)
    }

    @Test func 搜索与两个筛选是AND一起送后端() async {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        model.appFilter = "Safari"
        model.modelFilter = "gpt-4o-mini"
        model.query = "hel"
        // 每次修改都排了一次防抖后的重查；等它们跑完
        for _ in 0 ..< 20 { await Task.yield() }
        #expect(backend.filters.last == HistoryFilter(query: "hel", sourceApp: "Safari", model: "gpt-4o-mini"))
    }

    @Test func 防抖期间再改只查最后一次() async throws {
        let backend = FakeHistory()
        // 真的等一小段：前两次的等待在计时中被取消，只有最后一次真的查库
        let model = HistoryModel(backend: backend) { _ in try await Task.sleep(for: .milliseconds(20)) }
        model.query = "h"
        model.query = "he"
        model.query = "hel"
        // 机器忙时（并行跑测试）重查会晚到：等它到了再多等一会儿，确认没有第二次
        for _ in 0 ..< 200 where backend.filters.isEmpty { try await Task.sleep(for: .milliseconds(10)) }
        try await Task.sleep(for: .milliseconds(100))
        #expect(backend.filters.map(\.query) == ["hel"])
    }

    @Test func 数据库打不开时说清楚而不是显示空列表() async {
        let backend = FakeHistory()
        backend.fail = true
        let model = HistoryModel(backend: backend, sleep: instant)
        model.t = t
        await model.reload()
        #expect(model.status == "历史不可用：数据库坏了")
    }

    @Test func 收藏切换后重读并说出结果() async {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        model.t = t
        await model.reload()
        await model.toggleFavorite(record)
        #expect(model.favorited == [true])
        #expect(model.status == "已收藏")
        await model.toggleFavorite(record)
        #expect(model.favorited == [false])
        #expect(model.status == "已取消收藏")
    }

    @Test func 清空先确认取消时什么都不删() async {
        let backend = FakeHistory()
        backend.confirm = false
        let model = HistoryModel(backend: backend, sleep: instant)
        model.t = t
        await model.reload()
        await model.clearAll()
        #expect(backend.confirmed == [t("history.confirmClear")])
        #expect(backend.cleared == 0)
        #expect(model.records.count == 1)

        backend.confirm = true
        await model.clearAll()
        #expect(backend.cleared == 1)
        #expect(model.records.isEmpty)
        #expect(model.status == "已清除 1 条")
    }

    @Test func 删除一条后重读() async {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        await model.reload()
        await model.delete(1)
        #expect(backend.deleted == [1])
        #expect(model.records.isEmpty)
    }

    @Test func 再次编辑把原文与译文带进撰写窗() {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        model.editAgain(record)
        #expect(backend.composed.map(\.0) == ["Hello"])
        #expect(backend.composed.map(\.1) == ["你好"])
    }

    @Test func 收藏的复制与移除() async {
        let backend = FakeHistory()
        backend.favs = [Favorite(id: 7, createdAt: 0, kind: "word", text: "hello", translation: "", sourceLang: nil,
                                 targetLang: nil)]
        let model = HistoryModel(backend: backend, sleep: instant)
        await model.reload()
        await model.copyFavorite(model.favorites[0])
        #expect(backend.copied == ["hello"])
        await model.removeFavorite(7)
        #expect(model.favorites.isEmpty)
    }

    @Test func 隐私模式开着时如实标出() async {
        let backend = FakeHistory()
        backend.privacy = true
        let model = HistoryModel(backend: backend, sleep: instant)
        await model.reload()
        #expect(model.privacyMode)
    }
}
