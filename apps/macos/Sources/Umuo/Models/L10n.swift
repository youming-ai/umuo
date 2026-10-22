import Foundation

/// 界面语言，取值与 `settings.json` 里 `uiLanguage` 的写法一致（Tauri 版 `i18n/index.ts` 的 `Locale`）。
enum AppLocale: String, CaseIterable, Sendable {
    case zhCN = "zh-CN"
    case zhTW = "zh-TW"
    case en
    case ja

    /// 源语言：所有 key 在这里定义，其它语言由它回落。
    static let source = AppLocale.zhCN

    /// String Catalog 里的语言代码。
    var catalogCode: String {
        switch self {
        case .zhCN: "zh-Hans"
        case .zhTW: "zh-Hant"
        case .en: "en"
        case .ja: "ja"
        }
    }

    /// 设置里的语言值 + 系统语言偏好 → 真正使用的语言（`resolveLocale` 的同一规则）。
    ///
    /// 明选的语言优先；认不出来的值当作「跟随系统」——手改过的配置文件不该让界面变成一种不存在的语言。
    /// 系统偏好里繁体地区（台湾、香港、澳门、显式 Hant）认成繁体：只按 `zh` 前缀判断会让繁体用户看到简体。
    static func resolve(setting: String, systemLanguages: [String] = Locale.preferredLanguages) -> AppLocale {
        let wanted = setting.trimmingCharacters(in: .whitespacesAndNewlines)
        if !wanted.isEmpty, wanted != "system", let matched = AppLocale(rawValue: wanted) {
            return matched
        }
        for raw in systemLanguages {
            let tag = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if tag.isEmpty { continue }
            if tag.hasPrefix("zh") {
                let traditional = tag.contains("hant") || tag.contains("-tw") || tag.contains("-hk") || tag.contains("-mo")
                return traditional ? .zhTW : .zhCN
            }
            if tag.hasPrefix("ja") { return .ja }
            if tag.hasPrefix("en") { return .en }
        }
        return source
    }
}

/// String Catalog（`Resources/Strings/Localizable.xcstrings`，由 `scripts/export-xcstrings.ts` 从 Tauri 版文案表导出）。
///
/// **运行时自己读 JSON**，不走 `Bundle.localizedString`：SwiftPM 的 `.process` 要 Xcode 的 xcstringstool，
/// 只装 Command Line Tools 编不过；而且界面语言可以在设置里明选，不跟系统走，按语言取文案本来就得自己挑。
///
/// 占位符是 `%N$@`；每条的 `comment` 写着 `placeholders: a, b`，N 就是名字在这张表里的位置，
/// 所以调用方照旧按名字传参：`t("panel.replaceFailed", ["reason": …])`。
struct StringCatalog: Sendable {
    struct Entry: Sendable {
        /// 占位符名字，下标 + 1 就是 `%N$@` 里的 N。
        let names: [String]
        /// 语言代码 → 格式串。
        let values: [String: String]
    }

    let sourceLanguage: String
    let entries: [String: Entry]

    /// 应用自带的那份。读不出来是打包错误，直接崩在启动时比界面上满屏 key 好查。
    static let main: StringCatalog = {
        guard let url = Bundle.module.url(forResource: "Localizable", withExtension: "xcstrings", subdirectory: "Strings"),
              let data = try? Data(contentsOf: url),
              let catalog = try? StringCatalog(json: data)
        else { fatalError("Localizable.xcstrings 缺失或不是合法的 String Catalog") }
        return catalog
    }()

    init(json: Data) throws {
        struct Raw: Decodable {
            struct Unit: Decodable { let value: String }
            struct Localization: Decodable { let stringUnit: Unit }
            struct Key: Decodable {
                let comment: String?
                let localizations: [String: Localization]?
            }

            let sourceLanguage: String
            let strings: [String: Key]
        }
        let raw = try JSONDecoder().decode(Raw.self, from: json)
        sourceLanguage = raw.sourceLanguage
        entries = raw.strings.mapValues { key in
            Entry(names: Self.placeholderNames(comment: key.comment),
                  values: (key.localizations ?? [:]).mapValues(\.stringUnit.value))
        }
    }

    static func placeholderNames(comment: String?) -> [String] {
        let prefix = "placeholders:"
        guard let comment, comment.hasPrefix(prefix) else { return [] }
        return comment.dropFirst(prefix.count).split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// 取文案（`translate` 的同一规则）：本语言没有就回落源语言，连源语言都没有返回 key 本身
    /// （让它在界面上一眼可见，而不是空白）；没给的参数保留成 `{name}`，比渲染出空串好。
    func string(_ key: String, locale: AppLocale, params: [String: String] = [:]) -> String {
        guard let entry = entries[key],
              let template = entry.values[locale.catalogCode] ?? entry.values[sourceLanguage]
        else { return key }
        return Self.interpolate(template, names: entry.names, params: params)
    }

    /// `%N$@` → 参数值，`%%` → `%`。自己替换而不是 `String(format:)`：缺参数时不会读野指针。
    static func interpolate(_ template: String, names: [String], params: [String: String]) -> String {
        var out = ""
        var rest = Substring(template)
        while let percent = rest.firstIndex(of: "%") {
            out += rest[..<percent]
            let after = rest[rest.index(after: percent)...]
            if after.first == "%" {
                out += "%"
                rest = after.dropFirst()
                continue
            }
            let digits = after.prefix { $0.isNumber }
            let tail = after.dropFirst(digits.count)
            if let n = Int(digits), n >= 1, tail.hasPrefix("$@") {
                let name = n <= names.count ? names[n - 1] : "\(n)"
                out += params[name] ?? "{\(name)}"
                rest = tail.dropFirst(2)
            } else {
                out += "%"
                rest = after
            }
        }
        return out + rest
    }

    /// 一条格式串里用到的 `%N$@` 的 N（去重、排序），给一致性检查用。
    static func placeholderIndexes(_ template: String) -> [Int] {
        let regex = /%(\d+)\$@/
        return Array(Set(template.matches(of: regex).compactMap { Int($0.1) })).sorted()
    }
}

/// 取文案的函数，纯函数（reducer、格式化器）经参数拿到它，而不是读一个全局——那样就测不了了。
struct Translate: Sendable {
    let locale: AppLocale
    var catalog: StringCatalog = .main

    func callAsFunction(_ key: String, _ params: [String: String] = [:]) -> String {
        catalog.string(key, locale: locale, params: params)
    }
}
