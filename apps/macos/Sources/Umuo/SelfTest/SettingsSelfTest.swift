import Foundation
import UmuoCore

/// 设置窗交给 Rust 的那些 patch 真的过得了 `applySettingsPatch` 的校验，嵌套对象里的未知字段在 Rust 那边也留得住。
///
/// 视图模型的规则由 `swift test` 用假 backend 测；这里补的是两边的**形状**对不对得上：Swift 写出来的
/// `sceneModels`（含 null）、`monthlyLimits`、`customStyles`、连按快捷键、保留天数，Rust 都认，
/// 并且 `customStyles` / `monthlyLimits` / `sceneModels` 里不认识的字段存完还在。只用 `EngineSelfTest` 的临时配置目录。
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
            var scenes = values.object("sceneModels")
            scenes["futureScene"] = .string("keep")
            try apply(["sceneModels": .object(scenes)])
            scenes = SettingsRules.setScene(values.object("sceneModels"), .ocr,
                                            to: ModelRef(providerId: "deepseek", model: "deepseek-chat"))
            scenes = SettingsRules.setScene(scenes, .selection, to: nil)
            try apply(["sceneModels": .object(scenes)])
            let sceneOk = values.object("sceneModels")["ocr"]?.modelRef?.model == "deepseek-chat"
                && values.object("sceneModels")["futureScene"] == .string("keep")
            check("settings: sceneModels", sceneOk, "改 ocr、清 selection 后未知键保留：\(sceneOk)")

            let limits: [JSONValue] = [.object(["providerId": .string("openai"), "limitUsd": .number(5),
                                                "note": .string("keep")])]
            try apply(["monthlyLimits": .array(limits)])
            try apply(["monthlyLimits": .array(SettingsRules.setLimit(values.array("monthlyLimits"),
                                                                      providerId: "openai", to: 8))])
            let limit = values.array("monthlyLimits").first?.objectValue
            check("settings: monthlyLimits", limit?["limitUsd"] == .number(8) && limit?["note"] == .string("keep"),
                  "上限改成 8，未知字段：\(limit?["note"]?.stringValue ?? "丢了")")

            var style = StylePresets.new(now: 1)
            style.label = "简洁"
            style.temperature = StylePresets.parseTemperature("0.7")
            style.fewShot = [.init(source: "a", target: "甲")]
            style.raw["futureFlag"] = .bool(true)
            try apply(["customStyles": StylePresets.encode([style])])
            var decoded = StylePresets.decode(values.array("customStyles"))
            decoded[0].label = "更简洁"
            try apply(["customStyles": StylePresets.encode(decoded)])
            let stored = values.array("customStyles").first?.objectValue
            let styleOk = stored?["label"] == .string("更简洁") && stored?["futureFlag"] == .bool(true)
                && abs((stored?["temperature"]?.numberValue ?? 0) - 0.7) < 1e-3
            check("settings: customStyles", styleOk, "改标签后未知字段与温度保留：\(styleOk)")

            try apply(["selectionHotkey": .string("Ctrl Ctrl"), "historyRetentionDays": .number(30),
                       "selectionBlacklist": .array(SettingsRules.blacklist("1Password\n Slack ").map(JSONValue.string))])
            check("settings: 快捷键与保留天数", values.string("selectionHotkey") == "Ctrl Ctrl"
                && values.number("historyRetentionDays") == 30 && values.strings("selectionBlacklist") == ["1Password", "Slack"],
                "Ctrl Ctrl / 30 天 / 黑名单两项")
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

        // 术语表：只改名称时，条目与未知字段经 Swift 的结构体往返后仍在
        do {
            var glossary = Glossary(json: .object([
                "id": .string("g-settings"), "name": .string("旧"), "source_lang": .string(""), "target_lang": .string(""),
                "entries": .array([.object(["source": .string("a"), "target": .string("甲"), "note": .string("keep")])]),
                "color": .string("teal"),
            ]))!
            _ = try engine.glossarySaveJson(glossaryJson: GlossaryEditor.encode(glossary))
            glossary = GlossaryEditor.decode(engine.glossaryListJson()).first { $0.id == "g-settings" }!
            glossary.name = "新"
            glossary.sourceLang = "en"
            _ = try engine.glossarySaveJson(glossaryJson: GlossaryEditor.encode(glossary))
            let back = GlossaryEditor.decode(engine.glossaryListJson()).first { $0.id == "g-settings" }
            // 语言对要落在 Rust 认的字段上，而不是被当成未知字段存下（那样「这张表用不用」的判断看不到它）
            let ok = back?.name == "新" && back?.sourceLang == "en" && back?.raw["sourceLang"] == nil
                && back?.raw["color"] == .string("teal") && back?.entries.count == 1
            check("settings: 术语表改名", ok, "条目与未知字段保留：\(ok)")
        } catch {
            check("settings: 术语表改名", false, SettingsRules.message(error))
        }
    }
}
