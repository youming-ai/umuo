import Foundation
import UmuoCore

/// 设置窗交给 Rust 的那些 patch 真的过得了 `applySettingsPatch` 的校验，嵌套对象里的未知字段在 Rust 那边也留得住。
///
/// 视图模型的规则由 `swift test` 用假 backend 测；这里补的是两边的**形状**对不对得上：Swift 写出来的
/// `customStyles`、连按快捷键、保留天数，Rust 都认；退役的分场景模型、备用顺序与月度上限经过无关保存后原样还在。
/// 只用 `EngineSelfTest` 的临时配置目录。
enum SettingsSelfTest {
    static func run(_ engine: Engine, _ check: (String, Bool, String) -> Void) {
        guard var values = JSONValue.object(json: engine.settingsJson()) else {
            return check("settings 形状", false, "settingsJson 不是对象")
        }
        func apply(_ patch: SettingsValues) throws {
            let update = try engine.applySettingsPatch(patchJson: JSONValue.json(patch))
            values = JSONValue.object(json: update.settingsJson) ?? values
        }
        do {
            // 第三批精简退役的路由与预算字段：设置窗不再写它们，旧配置里的值也不能被一次无关保存抹掉。
            let routing: SettingsValues = [
                "sceneModels": .object(["ocr": .object(["provider_id": .string("deepseek"), "model": .string("deepseek-chat")]),
                                        "futureScene": .string("keep")]),
                "fallbackModels": .array([.object(["provider_id": .string("deepseek"), "model": .string("deepseek-chat")])]),
                "monthlyLimits": .array([.object(["providerId": .string("openai"), "limitUsd": .number(5),
                                                  "note": .string("keep")])]),
                "limitAction": .string("failover"),
            ]
            try apply(routing)
            try apply(["historyRetentionDays": .number(45)])
            let kept = routing.keys.allSatisfy { values[$0] == routing[$0] }
            check("settings: 退役路由与预算字段", kept, "无关保存后旧值保留：\(kept)")

            let retired: [JSONValue] = [.object(["id": .string("legacy"), "instruction": .string(""),
                                                 "temperature": .number(9), "future": .bool(true)])]
            try apply(["styleId": .string("legacy"), "customStyles": .array(retired)])
            try apply(["selectionHotkey": .string("Ctrl Ctrl"), "historyRetentionDays": .number(30),
                       "selectionBlacklist": .array(SettingsRules.blacklist("1Password\n Slack ").map(JSONValue.string))])
            check("settings: 快捷键与保留天数", values.string("selectionHotkey") == "Ctrl Ctrl"
                && values.number("historyRetentionDays") == 30 && values.strings("selectionBlacklist") == ["1Password", "Slack"],
                "Ctrl Ctrl / 30 天 / 黑名单两项")
            check("settings: 退役风格保留", values.array("customStyles") == retired && values.string("styleId") == "legacy",
                  "无关设置保存不校验或改写旧预设")
        } catch {
            check("settings 形状", false, SettingsRules.message(error))
        }

        // 校验不过时报 InvalidSetting，内存不变（设置窗据此退回那一行）
        do {
            _ = try engine.applySettingsPatch(patchJson: JSONValue.json(["proxyMode": .string("custom"), "proxyUrl": .string("")]))
            check("settings: 校验失败", false, "空的自定义代理地址被接受了")
        } catch {
            let unchanged = JSONValue.object(json: engine.settingsJson())?.string("proxyMode") == values.string("proxyMode")
            check("settings: 校验失败", unchanged, SettingsRules.message(error))
        }

    }
}
