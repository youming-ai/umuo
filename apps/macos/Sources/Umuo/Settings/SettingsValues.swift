import Foundation
import UmuoCore

/// 设置在 Swift 里就是 `[String: JSONValue]`（顶层键 → 值，见 `JSONValue`）。视图按键取它要的字段，
/// 缺键或类型不对时用与 Rust `Settings::default()` 一致的默认值——不会因为一个字段解不出来就整页打不开。
typealias SettingsValues = [String: JSONValue]

extension Dictionary where Key == String, Value == JSONValue {
    func string(_ key: String, _ fallback: String = "") -> String { self[key]?.stringValue ?? fallback }
    func bool(_ key: String, _ fallback: Bool = false) -> Bool { self[key]?.boolValue ?? fallback }
    func number(_ key: String, _ fallback: Double = 0) -> Double { self[key]?.numberValue ?? fallback }
    func array(_ key: String) -> [JSONValue] { self[key]?.arrayValue ?? [] }
    func object(_ key: String) -> [String: JSONValue] { self[key]?.objectValue ?? [:] }
    func strings(_ key: String) -> [String] { array(key).compactMap(\.stringValue) }
}

extension JSONValue {
    var arrayValue: [JSONValue]? { if case let .array(value) = self { value } else { nil } }
    var objectValue: [String: JSONValue]? { if case let .object(value) = self { value } else { nil } }
}

/// 设置页里几处「输入框文字 → 设置值」的规则。每一条都防一种真实会出的坏状态。
enum SettingsRules {
    /// 数字的显示：整数不带小数点（与 JS 的 `String(5)` 一致，保留天数 90 显示成「90」而不是「90.0」）。
    static func format(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 { return String(Int64(value)) }
        return String(value)
    }

    /// 数字框里填的东西认不认得出（浏览器 `<input type=number>` 的 `validity.badInput`）。
    /// 空串是「清空」，认得出；「10,5」认不出——直接提交会被当成清空，设过的值就这样被悄悄删掉了。
    static func isBadNumber(_ input: String) -> Bool {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return false }
        return text.wholeMatch(of: /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/) == nil
    }

    /// 历史保留天数：与 `isBadNumber` 同一口径读成数，再截去小数。负数与认不出的都归 0（不清理）——
    /// 传下去只会让清理逻辑算出未来的时间点。不能只取开头的整数：「1e3」会变成 1 天，保存即清掉几乎全部历史。
    /// 上限 100 年：`1e300` 也认得出，直接转 Int 会崩。
    static func retentionDays(_ input: String) -> Int {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isBadNumber(text), let value = Double(text), value.isFinite else { return 0 }
        return Int(min(max(value, 0), 36500))
    }

    /// 取词黑名单：每行一个应用名，去掉首尾空白与空行。
    static func blacklist(_ text: String) -> [String] {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// 选了一种代理模式之后做什么（AdvancedPage 的规则）。
    enum ProxyChoice: Equatable {
        /// 「自定义」要连同地址一起才是合法设置（后端会拒绝空地址）：先只在本地展开地址栏，等地址填好一起保存。
        /// 否则保存失败、模式被退回，地址栏也就永远出不来。
        case expandCustom
        /// 直接保存这个模式。
        case commit(String)
        /// 与已存的一样，什么都不做（只收起本地展开的地址栏）。
        case unchanged
    }

    static func proxyChoice(_ next: String, savedMode: String, savedUrl: String) -> ProxyChoice {
        if next == "custom", savedMode != "custom", savedUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .expandCustom
        }
        return next == savedMode ? .unchanged : .commit(next)
    }

    /// 导入前的确认说明：应用之前把会覆盖掉的、有副作用的都摆出来，用户点了「导入」才写。
    /// 端点决定 API Key 发往哪里，黑名单决定哪些应用里的选中内容会被读取，代理经手所有请求，
    /// 保留期改短会当场删历史——一份别人分享的配置不该悄悄改掉这些。没变化的项不提。
    static func importPreview(_ summary: ImportSummary, _ t: Translate) -> String {
        var parts = [t("prefs.general.importPreview", ["version": String(summary.bundleVersion)])]
        if !summary.endpointChanges.isEmpty {
            parts.append(t("prefs.general.importEndpoints", ["list": endpointList(summary, t)]))
        }
        switch summary.proxyChange {
        case nil: break
        case "system": parts.append(t("prefs.general.importProxySystem"))
        case "none": parts.append(t("prefs.general.importProxyNone"))
        case let url?: parts.append(t("prefs.general.importProxy", ["proxy": url]))
        }
        if !summary.blacklistRemoved.isEmpty {
            parts.append(t("prefs.general.importBlacklistRemoved", ["list": summary.blacklistRemoved.joined(separator: ", ")]))
        }
        if !summary.blacklistAdded.isEmpty {
            parts.append(t("prefs.general.importBlacklistAdded", ["list": summary.blacklistAdded.joined(separator: ", ")]))
        }
        if let days = summary.retentionShortenedTo { parts.append(t("prefs.general.importRetention", ["days": String(days)])) }
        if summary.hotkeysDiffer { parts.append(t("prefs.general.importHotkeys")) }
        if summary.replacedCustomStyleCount > 0 {
            parts.append(t("prefs.general.importReplacesStyles", ["count": String(summary.replacedCustomStyleCount)]))
        }
        if summary.replacedGlossaryCount > 0 {
            parts.append(t("prefs.general.importReplacesGlossaries", ["count": String(summary.replacedGlossaryCount)]))
        }
        return parts.joined(separator: "\n\n")
    }

    private static func endpointList(_ summary: ImportSummary, _ t: Translate) -> String {
        summary.endpointChanges
            .map { "\($0.providerId) → \($0.url.isEmpty ? t("prefs.general.importedEndpointDefault") : $0.url)" }
            .joined(separator: ", ")
    }

    /// 导入之后的说明（显示在「导入」那一行）。端点与取词黑名单的变化仍单独列出，确认框关掉之后也查得到。
    /// 旧风格与术语表只保留数据、不参与翻译，条数为 0 时不提。
    static func importNotice(_ result: ImportSummary, _ t: Translate) -> String {
        var parts = [t("prefs.general.imported", ["version": String(result.bundleVersion)])]
        if result.customStyleCount > 0 {
            parts.append(t("prefs.general.importedStyles", ["count": String(result.customStyleCount)]))
        }
        if result.glossaryCount > 0 {
            parts.append(t("prefs.general.importedGlossaries", ["count": String(result.glossaryCount)]))
        }
        if !result.endpointChanges.isEmpty {
            parts.append(t("prefs.general.importedEndpoints", ["list": endpointList(result, t)]))
        }
        if !result.blacklistAdded.isEmpty {
            parts.append(t("prefs.general.importedBlacklistAdded", ["list": result.blacklistAdded.joined(separator: ", ")]))
        }
        if !result.blacklistRemoved.isEmpty {
            parts.append(t("prefs.general.importedBlacklistRemoved", ["list": result.blacklistRemoved.joined(separator: ", ")]))
        }
        return parts.joined(separator: " ")
    }

    /// 错误给人看的那句话：Engine 的错误只取 `message`（不要把枚举名一起显示出来）。
    static func message(_ error: Error) -> String {
        if let engine = error as? EngineError {
            switch engine {
            case let .Open(message), let .InvalidSetting(message), let .Failed(message): return message
            }
        }
        return String(describing: error)
    }
}
