import Foundation

/// 一条自建风格预设（`settings.json` 的 `customStyles` 里的一项，PRD §5.7）。
///
/// 读写都经 `raw`：Rust 的 `CustomStyle` 带 `extra`（本版本不认识的字段），只解出界面要改的几个字段、
/// 存回时把它们盖在原对象上，别的键原样带回去——新版本加的字段，用户在这里改一次标签也不会丢。
struct CustomStyle: Equatable, Sendable, Identifiable {
    /// `id` 只给编辑器认行用（删掉中间一行时，别的行的输入框不能串到相邻的例句上），不写进设置、也不参与比较。
    struct Example: Equatable, Sendable, Identifiable {
        let id = UUID()
        var source: String
        var target: String
        var raw: [String: JSONValue] = [:]

        static func == (lhs: Example, rhs: Example) -> Bool {
            lhs.source == rhs.source && lhs.target == rhs.target && lhs.raw == rhs.raw
        }

        var json: JSONValue {
            var object = raw
            object["source"] = .string(source)
            object["target"] = .string(target)
            return .object(object)
        }
    }

    var id: String
    var label: String
    var instruction: String
    var temperature: Double
    var fewShot: [Example]
    var explain: Bool
    var raw: [String: JSONValue] = [:]

    init(id: String, label: String = "", instruction: String = "", temperature: Double = StylePresets.defaultTemperature,
         fewShot: [Example] = [], explain: Bool = false, raw: [String: JSONValue] = [:]) {
        self.id = id
        self.label = label
        self.instruction = instruction
        self.temperature = temperature
        self.fewShot = fewShot
        self.explain = explain
        self.raw = raw
    }

    /// 缺字段时取 Rust 侧 serde 的默认值（温度 0.2、其余为空）。
    init?(json: JSONValue) {
        guard let object = json.objectValue else { return nil }
        self.init(
            id: object.string("id"), label: object.string("label"), instruction: object.string("instruction"),
            temperature: object.number("temperature", StylePresets.defaultTemperature),
            fewShot: object.array("fewShot").compactMap { item in
                item.objectValue.map { Example(source: $0.string("source"), target: $0.string("target"), raw: $0) }
            },
            explain: object.bool("explain"), raw: object
        )
    }

    var json: JSONValue {
        var object = raw
        object["id"] = .string(id)
        object["label"] = .string(label)
        object["instruction"] = .string(instruction)
        object["temperature"] = .number(temperature)
        object["fewShot"] = .array(fewShot.map(\.json))
        object["explain"] = .bool(explain)
        return .object(object)
    }
}

/// 自建风格预设的纯逻辑，`style-presets.ts` 的移植。增删改都返回新数组，「取消编辑」才做得到。
enum StylePresets {
    /// 温度上限与 Rust 侧 `TEMPERATURE_RANGE` 一致（OpenAI 的上限）。
    static let maxTemperature = 2.0
    static let defaultTemperature = 0.2

    /// 新建一个空预设。id 用时间戳生成而不是从标签派生：标签随时会改，而 id 是**身份**——
    /// 历史记录按 id 关联「这句话是用哪套规则翻的」。前缀 `custom-` 保证不会撞上内置 id。
    /// `now` 是毫秒（与 JS 的 `Date.now()` 同一口径，id 的写法也一致：36 进制）。
    static func new(now: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> CustomStyle {
        CustomStyle(id: "custom-\(String(now, radix: 36))")
    }

    /// 列表里那一行摘要，不必展开就能看出这条预设的倾向。
    static func summary(_ style: CustomStyle, _ t: Translate) -> String {
        var parts = [t("prefs.presets.summaryTemperature", ["value": String(format: "%.1f", style.temperature)])]
        if !style.fewShot.isEmpty { parts.append(t("prefs.presets.summaryExamples", ["count": String(style.fewShot.count)])) }
        if style.explain { parts.append(t("prefs.presets.summaryExplain")) }
        if style.instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            parts.append(t("prefs.presets.summaryNoInstruction"))
        }
        return parts.joined(separator: t("prefs.listSeparator"))
    }

    /// 按 id 覆盖或追加（「保存」不区分新建与编辑，少一条分支就少一处不一致）。
    static func upsert(_ list: [CustomStyle], _ style: CustomStyle) -> [CustomStyle] {
        guard list.contains(where: { $0.id == style.id }) else { return list + [style] }
        return list.map { $0.id == style.id ? style : $0 }
    }

    static func remove(_ list: [CustomStyle], id: String) -> [CustomStyle] {
        list.filter { $0.id != id }
    }

    /// 温度输入的解析：空串、非数字回到默认值（而不是 0——清空输入框不该让温度悄悄变成最保守的 0），越界夹回范围。
    /// 与 JS 的 `parseFloat` 同一口径（取开头的数字），所以复用 `Limits.parse` 的那条正则。
    static func parseTemperature(_ input: String) -> Double {
        guard !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let parsed = leadingNumber(input) else {
            return defaultTemperature
        }
        return min(maxTemperature, max(0, parsed))
    }

    private static func leadingNumber(_ input: String) -> Double? {
        guard let match = input.firstMatch(of: /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/) else { return nil }
        return Double(match.output.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isFinite ? $0 : nil }
    }

    /// `customStyles` 的 JSON 数组 ↔ 结构体。
    static func decode(_ list: [JSONValue]) -> [CustomStyle] { list.compactMap(CustomStyle.init(json:)) }
    static func encode(_ list: [CustomStyle]) -> JSONValue { .array(list.map(\.json)) }
}
