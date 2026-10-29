import Foundation
import UmuoCore

/// 历史窗的展示逻辑，`history-format.ts` 的移植；验收用例在 Tests/UmuoTests/HistoryTests.swift（由 `history-format.test.ts` 逐条改写）。
///
/// 抽出来是为了能测：来源应用拿不到时必须留空而不是编一个。
enum HistoryFormat {
    /// 场景标签。存的是英文键，展示给用户的是界面语言。
    static func sceneLabel(_ scene: String, _ t: Translate) -> String {
        switch scene {
        case "selection": t("history.sceneSelection")
        case "silentReplace": t("history.sceneSilentReplace")
        case "compose": t("history.sceneCompose")
        case "ocr": t("history.sceneOcr")
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

    /// 一行的元信息：谁译的、什么风格、用了多少 token。
    static func recordMeta(_ record: HistoryRecord, _ t: Translate) -> String {
        var parts = ["\(record.providerId) · \(record.model)", sceneLabel(record.scene, t)]
        if !record.styleId.isEmpty { parts.append(record.styleId) }
        parts.append("\(record.inputTokens) → \(record.outputTokens) tokens")
        if record.estimated { parts.append(t("history.estimated")) }
        // 来源应用拿不到就整个略过，不显示空括号。
        if let app = record.sourceApp, !app.isEmpty { parts.append(app) }
        return parts.joined(separator: " · ")
    }

    /// 历史列表为空时的说法：搜索了却没结果，与真的一条记录都没有，是两件事。
    static func emptyText(query: String, _ t: Translate) -> String {
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? t("history.emptyNoRecords")
            : t("history.emptyNoMatch")
    }
}
