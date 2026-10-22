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

    /// `{ provider_id, model }` → ModelRef。不是对象时为 nil。
    ///
    /// **注意是 snake_case**：`umuo_core::wire::ModelRef` 没有 `rename_all`，settings.json 里的 `sceneModels` /
    /// `fallbackModels` 一直是 `provider_id`（外层设置是 camelCase，这一处例外）。写成 `providerId` 交给
    /// `applySettingsPatch` 会被拒（「missing field provider_id」），`--selftest` 的 settings 一项守着。
    /// 读的时候也认 `providerId`：手改过的配置不至于整行读不出来。
    var modelRef: ModelRef? {
        guard let object = objectValue else { return nil }
        return ModelRef(providerId: object["provider_id"]?.stringValue ?? object.string("providerId"),
                        model: object.string("model"))
    }

    init(_ ref: ModelRef) {
        self = .object(["provider_id": .string(ref.providerId), "model": .string(ref.model)])
    }
}

/// 设置页里几处「输入框文字 → 设置值」的规则。每一条都防一种真实会出的坏状态。
enum SettingsRules {
    /// 数字的显示：整数不带小数点（与 JS 的 `String(5)` 一致，月度上限 5 显示成「5」而不是「5.0」）。
    static func format(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 { return String(Int64(value)) }
        return String(value)
    }

    /// 数字框里填的东西认不认得出（浏览器 `<input type=number>` 的 `validity.badInput`）。
    /// 空串是「清空」，认得出；「10,5」认不出——直接提交会被当成清空，月度上限就这样被悄悄删掉了。
    static func isBadNumber(_ input: String) -> Bool {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return false }
        return text.wholeMatch(of: /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/) == nil
    }

    /// 历史保留天数（`Number.parseInt` 的口径：取开头的整数）。负数与认不出的都归 0（不清理）——
    /// 传下去只会让清理逻辑算出未来的时间点。
    static func retentionDays(_ input: String) -> Int {
        guard let match = input.firstMatch(of: /^\s*([+-]?\d+)/), let parsed = Int(match.1) else { return 0 }
        return max(0, parsed)
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

    /// 月度上限清单（`monthlyLimits`）里设置或清除一个供应商，**保留那一条里本版本不认识的字段**
    /// （`ProviderLimit` 带 `extra`，换成 Swift 结构体再编码回去就丢了）。规则同 `Limits.set`：nil = 清除，负数夹到 0。
    static func setLimit(_ list: [JSONValue], providerId: String, to value: Double?) -> [JSONValue] {
        let isTarget = { (item: JSONValue) in item.objectValue?.string("providerId") == providerId }
        let rest = list.filter { !isTarget($0) }
        guard let value, value.isFinite else { return rest }
        var entry = list.first(where: isTarget)?.objectValue ?? [:]
        entry["providerId"] = .string(providerId)
        entry["limitUsd"] = .number(max(0, value))
        return rest + [.object(entry)]
    }

    /// `monthlyLimits` → 只读视图用的结构体。
    static func limits(_ list: [JSONValue]) -> [ProviderLimit] {
        list.compactMap { item in
            guard let object = item.objectValue, let limit = object["limitUsd"]?.numberValue else { return nil }
            return ProviderLimit(providerId: object.string("providerId"), limitUsd: limit)
        }
    }

    /// 分场景模型改一个场景，**其余键原样保留**（`SceneModels` 带 `extra`，`compare` 也在同一个对象里）。
    /// 没配好 = 恢复「用默认模型」，写 null（Rust 侧是 `Option`）。
    static func setScene(_ scenes: [String: JSONValue], _ key: SceneKey, to ref: ModelRef?) -> [String: JSONValue] {
        var next = scenes
        next[key.rawValue] = ref.flatMap { $0.isComplete ? JSONValue($0) : nil } ?? .null
        return next
    }

    static func modelRefs(_ list: [JSONValue]) -> [ModelRef] { list.compactMap(\.modelRef) }

    /// 本月用量那一行（`history-format.ts` 的 `usageLine`）。`unpriced` 必须说出来：只报一个总额会让人以为
    /// 「这个月就花了这么点」，而实际有一部分根本没进这个总额。
    static func usageLine(_ usage: UsageSummary?, _ t: Translate) -> String {
        guard let usage else { return t("history.loadingUsage") }
        var params = [
            "count": String(usage.count), "input": String(usage.inputTokens), "output": String(usage.outputTokens),
            "cost": "$" + String(format: "%.4f", usage.costUsd),
        ]
        guard usage.unpriced > 0 else { return t("history.usageLine", params) }
        params["unpriced"] = String(usage.unpriced)
        return t("history.usageLineUnpriced", params)
    }

    /// 导入结果的说明。端点与取词黑名单的变化单独列出：前者决定 API Key 发往哪里，
    /// 后者决定哪些应用里的选中内容会被读取——一份别人分享的配置不该悄悄改掉它们。
    static func importNotice(_ result: ImportResult, _ t: Translate) -> String {
        var parts = [t("prefs.general.imported", [
            "version": String(result.bundleVersion),
            "styles": String(result.customStyleCount),
            "glossaries": String(result.glossaryCount),
        ])]
        if !result.endpointChanges.isEmpty {
            let list = result.endpointChanges
                .map { "\($0.providerId) → \($0.url.isEmpty ? t("prefs.general.importedEndpointDefault") : $0.url)" }
                .joined(separator: ", ")
            parts.append(t("prefs.general.importedEndpoints", ["list": list]))
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
