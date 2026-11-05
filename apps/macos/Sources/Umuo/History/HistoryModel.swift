import Foundation
import Observation
import UmuoCore

/// 历史窗往外要做的事。正式实现是 `EngineHistoryBackend`（Engine 的 SQLite 调用一律在后台），
/// 测试换成只记调用的假实现——历史窗的规则因此不碰真实历史库、剪贴板就能测。
@MainActor
protocol HistoryBackend: AnyObject {
    func query(_ filter: HistoryFilter, limit: UInt32, offset: UInt32) async throws -> [HistoryRecord]
    /// 隐私模式开着时列表是空的——要说清楚原因，否则用户以为记录丢了。
    func privacyMode() async throws -> Bool
    func delete(id: Int64) async throws
    /// 返回删掉了几条。
    func clear() async throws -> UInt32
    /// 清空前的确认。
    func confirmClear(_ message: String, confirm: String, cancel: String) async -> Bool
    /// 复制到剪贴板。失败返回原因。
    func copy(_ text: String) async -> String?
    /// 「再次编辑」：在撰写窗里打开这条记录。
    func openCompose(text: String, translation: String) throws
}

/// 历史窗的视图模型（PRD §5.9）。
///
/// 最近记录：列表 + 关键词搜索 + 删除 / 清空 + 复制 / 再次编辑。收藏与来源 / 模型筛选已退出（第四批精简），
/// 已有的收藏数据原样留在库里；费用与用量统计已退出（PRD §5.10）。
@MainActor @Observable
final class HistoryModel {
    /// 搜索输入的防抖：每敲一个字就查一次库没必要，输入停顿后再查（`SEARCH_DEBOUNCE_MS`）。
    static let debounce: Duration = .milliseconds(250)
    /// 每页条数。一次只读一页（多读一条判断后面还有没有），`pageSize + 1` 必须不超过内核单次上限
    /// （`crates/umuo-app/src/ops.rs` 的 `HISTORY_PAGE_MAX`，500），否则多读的那条被截掉、「显示更多」就消失了。
    static let pageSize: UInt32 = 100

    let backend: HistoryBackend
    private(set) var records: [HistoryRecord] = []
    private(set) var privacyMode = false
    /// 页头的一行状态（已清除、错误原因）。
    var status: String?
    /// 列表里选中的那一条：右键菜单与 Delete 键作用于它。
    var selection: Int64?
    /// 已经读了几页。「显示更多」就是多读一页，整页重读时按页逐个读。
    private(set) var pages = 1
    /// 后面还有没显示的记录：列表末尾给出「显示更多」，而不是静默截断。
    private(set) var hasMore = false

    /// 搜索关键词。改了就（防抖后）从第一页重查。
    var query = "" {
        didSet {
            guard query != oldValue else { return }
            pages = 1
            scheduleReload()
        }
    }

    var t = Translate(locale: .source)

    @ObservationIgnored private var pending: Task<Void, Never>?
    /// 每次 reload 的序号：慢的旧查询晚回来时不能盖掉新查询的结果。
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void

    init(backend: HistoryBackend, sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.backend = backend
        self.sleep = sleep
    }

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
        let filter = HistoryFilter(query: query)
        let size = Int(Self.pageSize)
        do {
            // 按页逐个读，每页多读一条：读到了就说明后面还有。不能一次读「页数 × 每页」条——
            // 内核单次最多返回 500 条，超过的部分会被截掉。
            var rows: [HistoryRecord] = []
            var more = false
            for page in 0 ..< pages {
                let fetched = try await backend.query(filter, limit: Self.pageSize + 1,
                                                      offset: Self.pageSize * UInt32(page))
                rows += fetched.prefix(size)
                more = fetched.count > size
                if !more { break }
            }
            let privacy = try await backend.privacyMode()
            guard mine == generation else { return }
            hasMore = more
            records = rows
            // 搜索或重载后不能让 Delete 仍指向列表外的旧记录。
            if let selection, !rows.contains(where: { $0.id == selection }) {
                self.selection = nil
            }
            privacyMode = privacy
            status = nil
        } catch {
            guard mine == generation else { return }
            status = t("history.unavailable", ["reason": SettingsRules.message(error)])
        }
    }

    /// 列表末尾的「显示更多」：多读一页。
    func loadMore() async {
        guard hasMore else { return }
        pages += 1
        await reload()
    }

    func delete(_ id: Int64) async {
        // 异步按钮任务执行时，搜索结果可能已更新；只删除当前列表中的记录。
        guard records.contains(where: { $0.id == id }) else { return }
        do {
            try await backend.delete(id: id)
            await reload()
        } catch {
            status = SettingsRules.message(error)
        }
    }

    /// 清空是破坏性操作，先确认。旧收藏数据不受影响。
    func clearAll() async {
        guard await backend.confirmClear(t("history.confirmClear"), confirm: t("history.clear"),
                                                cancel: t("common.cancel")) else { return }
        do {
            let removed = try await backend.clear()
            pages = 1
            await reload()
            status = t("history.cleared", ["count": "\(removed)"])
        } catch {
            status = SettingsRules.message(error)
        }
    }

    func copy(_ text: String) async {
        if let failure = await backend.copy(text) { status = failure }
    }

    func editAgain(_ record: HistoryRecord) {
        do { try backend.openCompose(text: record.sourceText, translation: record.translatedText) } catch {
            status = SettingsRules.message(error)
        }
    }
}
