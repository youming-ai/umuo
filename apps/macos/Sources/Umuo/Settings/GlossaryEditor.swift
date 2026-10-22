import Foundation

/// 一张术语表（`glossaries.json` 里的一项，PRD §5.8），Engine 以 JSON 交出来（`glossaryListJson`）。
///
/// 和 `CustomStyle` 一样经 `raw` 读写：`Glossary` / `GlossaryEntry` 带 `extra`，只改名称与语言对、
/// 存回时盖在原对象上，条目与别的未知字段原样带回去（`crates/umuo-ffi/src/ops.rs` 为此才走 JSON）。
///
/// **语言对的键是 snake_case**（`source_lang` / `target_lang`）：`umuo_core::glossary::Glossary` 没有 `rename_all`，
/// Rust 判断「这张表用不用」只看这两个键。写成 `sourceLang` 会被当成未知字段原样存下、语言对却一直是「不限」。
struct Glossary: Equatable, Sendable, Identifiable {
    static let sourceKey = "source_lang"
    static let targetKey = "target_lang"

    var id: String
    var name: String
    var sourceLang: String
    var targetLang: String
    var raw: [String: JSONValue] = [:]

    init(id: String, name: String = "", sourceLang: String = "", targetLang: String = "", raw: [String: JSONValue] = [:]) {
        self.id = id
        self.name = name
        self.sourceLang = sourceLang
        self.targetLang = targetLang
        self.raw = raw
    }

    init?(json: JSONValue) {
        guard let object = json.objectValue else { return nil }
        self.init(id: object.string("id"), name: object.string("name"), sourceLang: object.string(Self.sourceKey),
                  targetLang: object.string(Self.targetKey), raw: object)
    }

    /// 条目（只读：改条目走「粘贴 CSV → `glossaryImport`」，那一步在 Rust 里解析）。
    var entries: [(source: String, target: String)] {
        raw.array("entries").compactMap { $0.objectValue.map { ($0.string("source"), $0.string("target")) } }
    }

    var json: JSONValue {
        var object = raw
        object["id"] = .string(id)
        object["name"] = .string(name)
        object[Self.sourceKey] = .string(sourceLang)
        object[Self.targetKey] = .string(targetLang)
        if object["entries"] == nil { object["entries"] = .array([]) }
        return .object(object)
    }
}

/// 术语表编辑器的纯逻辑，`glossary-editor.ts` 的移植。
///
/// 解析（逗号 / 制表符、引号、BOM、表头）全在 Rust 侧（`umuo_core::glossary::parse_delimited`），这里**不重复实现**——
/// 两处各写一遍，迟早会出现「粘贴进去 10 条、只导入 8 条却没人知道为什么」。
enum GlossaryEditor {
    /// 新建一张空表。id 用时间戳（毫秒，36 进制，与 Tauri 版一致）而不是从名称派生：名称随时会改，而 id 是身份。
    static func new(now: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> Glossary {
        Glossary(id: "glossary-\(String(now, radix: 36))")
    }

    /// 列表里那一行摘要：语言对 + 条数。留空的语言写成「不限」，而不是显示成空（「 → zh-CN」会让人以为配置坏了）。
    static func summary(_ glossary: Glossary, _ t: Translate) -> String {
        let pair = [glossary.sourceLang, glossary.targetLang]
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .map { $0.isEmpty ? t("prefs.glossary.anyLang") : $0 }
            .joined(separator: " → ")
        return t("prefs.glossary.summary", ["pair": pair, "count": String(glossary.entries.count)])
    }

    /// 语言对是否填了约束（仅用于界面提示；真正的判定在 Rust 的 `glossary::applies_to`）。
    static func hasLanguageConstraint(_ glossary: Glossary) -> Bool {
        !glossary.sourceLang.trimmingCharacters(in: .whitespaces).isEmpty
            || !glossary.targetLang.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// 打开编辑框时把现有条目反填成 TSV（每行「原文⇥译文」），用户可以就地改。
    static func editableText(_ glossary: Glossary) -> String {
        glossary.entries.map { "\($0.source)\t\($0.target)" }.joined(separator: "\n")
    }

    /// `glossaryListJson` 的结果 → 结构体。不是数组时为空（读不到不该让设置窗崩掉）。
    static func decode(_ json: String) -> [Glossary] {
        guard case let .array(items)? = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return [] }
        return items.compactMap(Glossary.init(json:))
    }

    static func encode(_ glossary: Glossary) -> String {
        String(decoding: (try? JSONEncoder().encode(glossary.json)) ?? Data("{}".utf8), as: UTF8.self)
    }

    /// 导出成文件时的默认文件名：表名里不能进文件名的字符换掉，空名用 id。
    static func exportFileName(_ glossary: Glossary) -> String {
        let base = glossary.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let safe = String((base.isEmpty ? glossary.id : base).map { "/:\\".contains($0) ? "-" : $0 })
        return safe + ".csv"
    }
}
