import Foundation

/// 一条月度上限（`settings.json` 的 `providerLimits` 里的一项）。
struct ProviderLimit: Equatable, Sendable {
    var providerId: String
    var limitUsd: Double
}

/// 月度上限的编辑逻辑（PRD §5.10），`limits.ts` 的移植。
///
/// 上限清单是「稀疏」的：只有用户设过的供应商才有条目。把「没设」与「设成 0」分开是这一块的核心——
/// 0 表示「这个供应商一分钱也不许花」，是有效的用法（临时停用某个供应商，但保留它的 Key）。
enum Limits {
    /// 取某个供应商的上限。没设过返回 nil（而不是 0）。
    static func limit(_ limits: [ProviderLimit], for providerId: String) -> Double? {
        limits.first { $0.providerId == providerId }?.limitUsd
    }

    /// 设置或清除某个供应商的上限。nil（或非有限数）= 清除，而不是记成 0——
    /// 记成 0 会把「取消上限」变成「禁止花钱」，两个完全相反的意思。负数夹到 0。
    static func set(_ limits: [ProviderLimit], providerId: String, to value: Double?) -> [ProviderLimit] {
        let rest = limits.filter { $0.providerId != providerId }
        guard let value, value.isFinite else { return rest }
        return rest + [ProviderLimit(providerId: providerId, limitUsd: max(0, value))]
    }

    /// 解析上限输入框。空串 = 清除上限（nil），认不出数字也是 nil；负数夹到 0。
    ///
    /// 与 JS 的 `parseFloat` 同一口径：取开头最长的一段数字（`"5.5abc"` → 5.5），所以不能用 `Double(_:)`。
    static func parse(_ input: String) -> Double? {
        if input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
        let pattern = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
        guard let match = input.firstMatch(of: pattern),
              let parsed = Double(match.output.trimmingCharacters(in: .whitespacesAndNewlines)),
              parsed.isFinite
        else { return nil }
        return max(0, parsed)
    }

    /// 某个供应商本月的花费。没有记录就是 0。
    static func spend(_ spends: [(providerId: String, costUsd: Double)], for providerId: String) -> Double {
        spends.first { $0.providerId == providerId }?.costUsd ?? 0
    }

    /// 一行上限的摘要。超限时必须明确写出来，而不是只显示两个数字让人自己比大小。
    /// 正好花到上限也算超限，与 Rust 侧 `>=` 的口径一致。
    static func summary(limit: Double?, spentUsd: Double, _ t: Translate) -> String {
        let spent = "$" + String(format: "%.4f", spentUsd)
        guard let limit else { return t("prefs.advanced.spentUnlimited", ["spent": spent]) }
        let key = spentUsd >= limit ? "prefs.advanced.spentOver" : "prefs.advanced.spentOf"
        return t(key, ["spent": spent, "limit": "$" + String(format: "%.2f", limit)])
    }
}
