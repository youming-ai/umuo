import Foundation
import UmuoCore

/// 历史窗的展示逻辑，`history-format.ts` 的移植；验收用例在 Tests/UmuoTests/HistoryTests.swift（由 `history-format.test.ts` 逐条改写）。
///
/// 抽出来是为了能测：这些函数里有几处「不能含糊」的取舍——
/// 价格未知时必须说「未计价」而不是显示 $0，来源应用拿不到时必须留空而不是编一个。
enum HistoryFormat {
    /// 按日柱状图看多少天（`BAR_WINDOW_DAYS`）。
    static let barWindowDays = 14

    /// 场景标签。存的是英文键，展示给用户的是界面语言。
    static func sceneLabel(_ scene: String, _ t: Translate) -> String {
        switch scene {
        case "selection": t("history.sceneSelection")
        case "silentReplace": t("history.sceneSilentReplace")
        case "compose": t("history.sceneCompose")
        case "compare": t("history.sceneCompare")
        // 未知场景原样显示：以后加了新场景时，历史里显示一个英文键也比显示「未知」更能说明问题。
        default: scene
        }
    }

    /// 本地时间 `YYYY-MM-DD HH:mm`。历史列表里按这个排序阅读最省事。
    static func timestamp(_ unixSeconds: Int64, calendar: Calendar = .current) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(unixSeconds))
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        func pad(_ n: Int?) -> String { String(format: "%02d", n ?? 0) }
        return "\(c.year ?? 0)-\(pad(c.month))-\(pad(c.day)) \(pad(c.hour)):\(pad(c.minute))"
    }

    /// 费用：`$` + 四位小数（JS 的 `toFixed(4)`）。
    static func cost(_ usd: Double) -> String { "$" + String(format: "%.4f", usd) }

    /// 一行的元信息：谁译的、什么风格、用了多少、花了多少。
    static func recordMeta(_ record: HistoryRecord, _ t: Translate) -> String {
        var parts = ["\(record.providerId) · \(record.model)", sceneLabel(record.scene, t)]
        if !record.styleId.isEmpty { parts.append(record.styleId) }
        parts.append("\(record.inputTokens) → \(record.outputTokens) tokens")
        if record.estimated { parts.append(t("history.estimated")) }
        // 价格未知时说「未计价」，而不是显示 $0.0000——那会让人以为它是免费的。
        parts.append(record.costUsd.map(cost) ?? t("history.unpriced"))
        // 来源应用拿不到就整个略过，不显示空括号。
        if let app = record.sourceApp, !app.isEmpty { parts.append(app) }
        return parts.joined(separator: " · ")
    }

    /// 本月用量文案（月度汇总）。`unpriced` 必须显示出来：只报一个总额会让人以为「这个月就花了这么点」，
    /// 而实际有一部分根本没进这个总额。
    static func usageLine(_ usage: UsageSummary?, _ t: Translate) -> String {
        guard let usage else { return t("history.loadingUsage") }
        let params = ["count": "\(usage.count)", "input": "\(usage.inputTokens)", "output": "\(usage.outputTokens)",
                      "cost": cost(usage.costUsd)]
        return usage.unpriced > 0
            ? t("history.usageLineUnpriced", params.merging(["unpriced": "\(usage.unpriced)"]) { $1 })
            : t("history.usageLine", params)
    }

    /// 按日柱状图里的一根柱子。
    struct DayBar: Equatable, Sendable {
        let day: String
        /// 只取 `MM-DD` 用于横轴标签——完整的年份在这一屏里是噪音。
        let label: String
        let count: UInt32
        let costUsd: Double
        let unpriced: UInt32
        /// 相对窗口内最大值的比例（0...1）。全为 0 时是 0，不会除零。
        let ratio: Double
    }

    /// 把按日用量整理成柱状图数据。`days` 来自存储层，**只包含有记录的那些天**——这里不补零，
    /// 而是按日期升序排列已有数据：补零会让「一周里只有两天有记录」看起来像有七天数据。
    static func dailyBars(_ days: [DayUsage], limit: Int = barWindowDays) -> [DayBar] {
        let recent = days.sorted { $0.day < $1.day }.suffix(limit)
        let peak = recent.map(\.count).max() ?? 0
        return recent.map { day in
            DayBar(day: day.day, label: String(day.day.dropFirst(5)), count: day.count, costUsd: day.costUsd,
                   unpriced: day.unpriced, ratio: peak > 0 ? Double(day.count) / Double(peak) : 0)
        }
    }

    /// 单根柱子的悬浮说明。
    static func dayBarTitle(_ bar: DayBar, _ t: Translate) -> String {
        let params = ["day": bar.day, "count": "\(bar.count)", "cost": cost(bar.costUsd)]
        return bar.unpriced > 0
            ? t("history.dayBarTitleUnpriced", params.merging(["unpriced": "\(bar.unpriced)"]) { $1 })
            : t("history.dayBarTitle", params)
    }

    /// 柱子的像素高度：最小 2pt——次数极少那天也留一条基线，否则柱子整根消失、看起来像坏了。
    static func barHeight(_ ratio: Double, max: Double = 36) -> Double { Swift.max(2, (ratio * max).rounded()) }

    /// 收藏列表里那一行的副标题。
    static func favoriteMeta(_ favorite: Favorite, _ t: Translate) -> String {
        var parts = [favorite.kind == "word" ? t("history.favoriteWord") : t("history.favoriteSentence")]
        if let lang = favorite.targetLang, !lang.isEmpty { parts.append(lang) }
        return parts.joined(separator: " · ")
    }

    /// 收藏「复制」的内容：旧版本可能存过空串译文（审查 L23），空串要退回原文，不能把空串复制进剪贴板。
    static func favoriteCopyText(_ favorite: Favorite) -> String {
        if let translation = favorite.translation, !translation.isEmpty { return translation }
        return favorite.text
    }

    /// 「收藏」分页的标题：有收藏时带上条数。
    static func favoritesTab(count: Int, _ t: Translate) -> String {
        count > 0 ? t("history.tabFavoritesCount", ["count": "\(count)"]) : t("history.tabFavorites")
    }

    /// 历史列表为空时的说法：搜索了却没结果，与真的一条记录都没有，是两件事。
    static func emptyText(query: String, _ t: Translate) -> String {
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? t("history.emptyNoRecords")
            : t("history.emptyNoMatch")
    }
}
