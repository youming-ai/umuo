import Foundation
import Testing
import UmuoCore
@testable import Umuo

// 历史窗的展示逻辑，外加历史窗视图模型的规则（三个条件一起送后端、防抖、失败要说清楚、
// 收藏状态逐行对上、清空先确认、再次编辑不带浮窗归属）。假 backend 只记调用：不碰真实历史库与剪贴板。

/// 断言的是简体中文文案，与源语言一致。
private let t = Translate(locale: .zhCN)

private let record = HistoryRecord(
    id: 1, createdAt: 1_700_000_000, sourceText: "Hello", translatedText: "你好", sourceLang: "en", targetLang: "zh-CN",
    providerId: "openai", model: "gpt-4o-mini", styleId: "standard", scene: "selection", sourceApp: "Safari",
    inputTokens: 100, outputTokens: 40, estimated: false
)

private func with(_ change: (inout HistoryRecord) -> Void) -> HistoryRecord {
    var copy = record
    change(&copy)
    return copy
}

@Suite("历史：场景标签")
struct HistorySceneTests {
    @Test func 把内部场景键翻成用户看得懂的中文() {
        #expect(HistoryFormat.sceneLabel("selection", t) == "划词")
        #expect(HistoryFormat.sceneLabel("silentReplace", t) == "原地替换")
        #expect(HistoryFormat.sceneLabel("compose", t) == "撰写窗")
        #expect(HistoryFormat.sceneLabel("ocr", t) == "截图")
        #expect(HistoryFormat.sceneLabel("compare", t) == "对比")
        #expect(HistoryFormat.sceneLabel("voice", t) == "语音")
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

    @Test func 包含模型场景与token但不再显示费用() {
        let meta = HistoryFormat.recordMeta(record, t)
        #expect(meta.contains("openai · gpt-4o-mini"))
        #expect(meta.contains("划词"))
        #expect(meta.contains("100 → 40 tokens"))
        #expect(meta.contains("Safari"))
        #expect(!meta.contains("$"))
        #expect(!meta.contains("未计价"))
    }

    @Test func 用量是估算时明确标注() {
        #expect(HistoryFormat.recordMeta(with { $0.estimated = true }, t).contains("估算"))
    }

    @Test func 拿不到来源应用时整个略过() {
        for app in [nil, ""] as [String?] {
            let meta = HistoryFormat.recordMeta(with { $0.sourceApp = app }, t)
            #expect(meta.components(separatedBy: " · ").last?.isEmpty == false)
            #expect(meta.hasSuffix("tokens"))
        }
    }
}


@Suite("历史：空列表")
struct HistoryEmptyTextTests {
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
    var filters: [HistoryFilter] = []
    var fail = false
    var confirm = true
    var confirmed: [String] = []
    var deleted: [Int64] = []
    var cleared = 0
    var copied: [String] = []
    var composed: [(String, String)] = []
    var privacy = false
    var limits: [UInt32] = []

    func query(_ filter: HistoryFilter, limit: UInt32) async throws -> [HistoryRecord] {
        filters.append(filter)
        limits.append(limit)
        if fail { throw Broken() }
        return Array(rows.prefix(Int(limit)))
    }

    func privacyMode() async throws -> Bool { privacy }

    func delete(id: Int64) async throws {
        deleted.append(id)
        rows.removeAll { $0.id == id }
    }

    func clear() async throws -> UInt32 {
        cleared += 1
        defer { rows = [] }
        return UInt32(rows.count)
    }

    func confirmClear(_ message: String, confirm _: String, cancel _: String) async -> Bool {
        confirmed.append(message)
        return confirm
    }

    func copy(_ text: String) async -> String? {
        copied.append(text)
        return nil
    }

    func openCompose(text: String, translation: String) throws { composed.append((text, translation)) }
}

/// 防抖的等待换成「什么都不等」：测的是「改了就重查」，不是计时器。
private let instant: @Sendable (Duration) async throws -> Void = { _ in }

@MainActor
@Suite("历史窗视图模型")
struct HistoryModelTests {
    @Test func 载入后列表到位() async {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        model.t = t
        await model.reload()
        #expect(model.records.map(\.id) == [1])
        #expect(model.status == nil)
    }

    @Test func 超过一页时不静默截断_显示更多再读一页_换搜索词回到第一页() async {
        let backend = FakeHistory()
        let page = Int(HistoryModel.pageSize)
        backend.rows = (1 ... page * 2 + 5).map { id in with { $0.id = Int64(id) } }
        let model = HistoryModel(backend: backend, sleep: instant)
        model.t = t
        await model.reload()
        #expect(model.records.count == page)
        #expect(model.hasMore)
        await model.loadMore()
        #expect(model.records.count == page * 2)
        #expect(model.hasMore)
        await model.loadMore()
        #expect(model.records.count == page * 2 + 5)
        #expect(!model.hasMore)
        await model.loadMore()
        #expect(model.pages == 3)

        model.query = "Hello"
        for _ in 0 ..< 200 where backend.filters.last?.query != "Hello" { await Task.yield() }
        #expect(model.pages == 1)
        #expect(backend.limits.last == HistoryModel.pageSize + 1)
    }

    @Test func 正好一页时不给显示更多() async {
        let backend = FakeHistory()
        backend.rows = (1 ... Int(HistoryModel.pageSize)).map { id in with { $0.id = Int64(id) } }
        let model = HistoryModel(backend: backend, sleep: instant)
        await model.reload()
        #expect(model.records.count == Int(HistoryModel.pageSize))
        #expect(!model.hasMore)
    }

    @Test func 搜索词改了就送后端() async {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        model.query = "hel"
        // 修改排了一次防抖后的重查；等它跑完
        for _ in 0 ..< 20 { await Task.yield() }
        #expect(backend.filters.last == HistoryFilter(query: "hel"))
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

    @Test func 重载保留仍可见的选择并清理筛选外的选择() async {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        await model.reload()
        model.selection = 1
        await model.reload()
        #expect(model.selection == 1)

        backend.rows = [with { $0.id = 2 }]
        await model.reload()
        #expect(model.records.map(\.id) == [2])
        #expect(model.selection == nil)
    }

    @Test func 失效的删除任务不能删除当前列表外的记录() async {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        await model.reload()
        backend.rows = []
        await model.reload()
        // 模拟搜索前已排队的 Delete 任务，以及系统列表尚未清理的选择。
        model.selection = 1
        await model.delete(1)
        #expect(backend.deleted.isEmpty)
    }

    @Test func 删除或清空后清理已不存在的选择() async {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        await model.reload()
        model.selection = 1
        await model.delete(1)
        #expect(model.selection == nil)

        backend.rows = [record]
        await model.reload()
        model.selection = 1
        await model.clearAll()
        #expect(model.selection == nil)
    }

    @Test func 再次编辑把原文与译文带进撰写窗() {
        let backend = FakeHistory()
        let model = HistoryModel(backend: backend, sleep: instant)
        model.editAgain(record)
        #expect(backend.composed.map(\.0) == ["Hello"])
        #expect(backend.composed.map(\.1) == ["你好"])
    }

    @Test func 隐私模式开着时如实标出() async {
        let backend = FakeHistory()
        backend.privacy = true
        let model = HistoryModel(backend: backend, sleep: instant)
        await model.reload()
        #expect(model.privacyMode)
    }
}
