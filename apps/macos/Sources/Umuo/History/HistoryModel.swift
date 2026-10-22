import Foundation
import Observation
import UmuoCore

/// 历史窗往外要做的事。正式实现是 `EngineHistoryBackend`（Engine 的 SQLite 调用一律在后台），
/// 测试换成只记调用的假实现——历史窗的规则因此不碰真实历史库、剪贴板就能测。
@MainActor
protocol HistoryBackend: AnyObject {
    func query(_ filter: HistoryFilter, limit: UInt32) async throws -> [HistoryRecord]
    func favoritesStatus(_ texts: [String]) async throws -> [Bool]
    func usageSummary() async throws -> UsageSummary
    func usageDaily(days: UInt32) async throws -> [DayUsage]
    func favorites(limit: UInt32) async throws -> [Favorite]
    func facets() async throws -> HistoryFacets
    /// 隐私模式开着时列表是空的——要说清楚原因，否则用户以为记录丢了。
    func privacyMode() async throws -> Bool
    /// 返回切换**之后**的状态（true = 现在已收藏）。
    func favoriteToggle(text: String, translation: String?) async throws -> Bool
    func favoriteRemove(id: Int64) async throws
    func delete(id: Int64) async throws
    /// 返回删掉了几条。
    func clear() async throws -> UInt32
    /// 清空前的确认（Tauri 的 `window.confirm`）。
    func confirmClear(_ message: String, confirm: String, cancel: String) -> Bool
    /// 复制到剪贴板。失败返回原因。
    func copy(_ text: String) async -> String?
    /// 「再次编辑」：在撰写窗里打开这条记录。
    func openCompose(text: String, translation: String) throws
}

/// 历史窗的视图模型，`history.tsx` 的状态与规则，语义逐条一致（PRD §5.9 / §5.10）。
///
/// 两个分页：**历史**（列表 + 检索 + 筛选 + 删除 + 收藏）与**收藏**（用户显式保存的词句）；顶部是本月用量与最近两周的按日用量。
/// 收藏与历史刻意不是同一份数据：历史会被「保留天数」清掉，收藏不会。
@MainActor @Observable
final class HistoryModel {
    enum Tab: Equatable, Sendable { case history, favorites }

    /// 搜索输入的防抖：每敲一个字就查一次库没必要，输入停顿后再查（`SEARCH_DEBOUNCE_MS`）。
    static let debounce: Duration = .milliseconds(250)
    static let pageSize: UInt32 = 100

    let backend: HistoryBackend
    var tab = Tab.history
    private(set) var records: [HistoryRecord] = []
    /// 与 `records` 一一对应的收藏状态。
    private(set) var favorited: [Bool] = []
    private(set) var favorites: [Favorite] = []
    private(set) var usage: UsageSummary?
    private(set) var days: [DayUsage] = []
    private(set) var facets = HistoryFacets(apps: [], models: [])
    private(set) var privacyMode = false
    /// 页头的一行状态（已收藏、已清除、错误原因）。
    var status: String?

    /// 搜索与两个筛选：三者 AND，一起送后端。改了就（防抖后）重查。
    var query = "" { didSet { if query != oldValue { scheduleReload() } } }
    var appFilter = "" { didSet { if appFilter != oldValue { scheduleReload() } } }
    var modelFilter = "" { didSet { if modelFilter != oldValue { scheduleReload() } } }

    var t = Translate(locale: .source)
    var theme = ResolvedTheme.light
    var palette: Palette { .of(theme) }

    @ObservationIgnored private var pending: Task<Void, Never>?
    /// 每次 reload 的序号：慢的旧查询晚回来时不能盖掉新查询的结果。
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void

    init(backend: HistoryBackend, sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.backend = backend
        self.sleep = sleep
    }

    var bars: [HistoryFormat.DayBar] { HistoryFormat.dailyBars(days) }
    var usageLine: String { HistoryFormat.usageLine(usage, t) }

    /// 输入停顿 250 ms 后再查；期间再改就重新计时。
    private func scheduleReload() {
        pending?.cancel()
        let sleep = sleep
        pending = Task {
            do { try await sleep(Self.debounce) } catch { return }
            await self.reload()
        }
    }

    /// 整页重读（打开窗口、窗口重新获得焦点、增删之后）。数据库打不开时要说清楚，而不是显示一个空列表让用户以为记录没了。
    func reload() async {
        generation += 1
        let mine = generation
        let filter = HistoryFilter(query: query, sourceApp: appFilter, model: modelFilter)
        do {
            let rows = try await backend.query(filter, limit: Self.pageSize)
            // 一次问完一屏的收藏状态，而不是逐行问一次。
            let stars = try await backend.favoritesStatus(rows.map(\.sourceText))
            let usage = try await backend.usageSummary()
            let days = try await backend.usageDaily(days: UInt32(HistoryFormat.barWindowDays))
            let favorites = try await backend.favorites(limit: Self.pageSize)
            let facets = try await backend.facets()
            let privacy = try await backend.privacyMode()
            guard mine == generation else { return }
            records = rows
            favorited = stars.count == rows.count ? stars : Array(repeating: false, count: rows.count)
            self.usage = usage
            self.days = days
            self.favorites = favorites
            self.facets = facets
            privacyMode = privacy
            status = nil
        } catch {
            guard mine == generation else { return }
            status = t("history.unavailable", ["reason": SettingsRules.message(error)])
        }
    }

    /// 收藏的是**原文 + 译文这一对**；判定「单词还是句子」由 Rust 侧用词卡规则决定，这里不重复实现。
    func toggleFavorite(_ record: HistoryRecord) async {
        do {
            let now = try await backend.favoriteToggle(text: record.sourceText, translation: record.translatedText)
            await reload()
            status = now ? t("history.favorited") : t("history.unfavorited")
        } catch {
            status = SettingsRules.message(error)
        }
    }

    func delete(_ id: Int64) async {
        do {
            try await backend.delete(id: id)
            await reload()
        } catch {
            status = SettingsRules.message(error)
        }
    }

    /// 清空是破坏性操作，先确认。收藏不受影响。
    func clearAll() async {
        guard backend.confirmClear(t("history.confirmClear"), confirm: t("history.clear"),
                                          cancel: t("prefs.presets.cancel")) else { return }
        do {
            let removed = try await backend.clear()
            await reload()
            status = t("history.cleared", ["count": "\(removed)"])
        } catch {
            status = SettingsRules.message(error)
        }
    }

    func removeFavorite(_ id: Int64) async {
        do {
            try await backend.favoriteRemove(id: id)
            await reload()
        } catch {
            status = SettingsRules.message(error)
        }
    }

    func copy(_ text: String) async {
        if let failure = await backend.copy(text) { status = failure }
    }

    func copyFavorite(_ favorite: Favorite) async { await copy(HistoryFormat.favoriteCopyText(favorite)) }

    func editAgain(_ record: HistoryRecord) {
        do { try backend.openCompose(text: record.sourceText, translation: record.translatedText) } catch {
            status = SettingsRules.message(error)
        }
    }
}
