import Foundation

/// 任意 JSON 值。设置在 Swift 里就是 `[String: JSONValue]`：**不用 Codable 解整份 settings.json**
/// （缺一个键就整体解码失败，老用户的设置会被重置，见 docs/SWIFTUI-MIGRATION.md「必须守住的兼容性」），
/// 视图要哪个字段就按键取哪个，改动经 `Engine.applySettingsPatch` 只交改了的顶层键。
enum JSONValue: Equatable, Sendable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case let .bool(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .string(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        }
    }

    var stringValue: String? { if case let .string(value) = self { value } else { nil } }
    var boolValue: Bool? { if case let .bool(value) = self { value } else { nil } }
    var numberValue: Double? { if case let .number(value) = self { value } else { nil } }

    /// JSON 文本 → 顶层对象。不是对象时为 nil。
    static func object(json: String) -> [String: JSONValue]? {
        guard case let .object(object)? = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        return object
    }

    /// 顶层对象 → JSON 文本（给 `applySettingsPatch`）。
    static func json(_ object: [String: JSONValue]) -> String {
        // 只含 JSONValue 的对象一定能编码
        String(decoding: try! JSONEncoder().encode(object), as: UTF8.self)
    }
}
