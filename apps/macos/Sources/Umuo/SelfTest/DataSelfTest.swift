import Foundation
import UmuoCore

/// 历史窗、快捷面板、首次引导从 Rust 拿到的东西，在 Swift 这边真的排得出来：
/// 带筛选的历史查询、记录的元信息、
/// 快捷面板的状态（暂停由宿主传入、最近一条就是刚才那次翻译）、引导写进去的 `providerId` + `model` 与 `onboardingDone`
/// 过得了 `applySettingsPatch`、删除与清空。
///
/// 视图模型的规则由 `swift test` 用假 backend 测；这里补的是两边对不对得上。只用 `EngineSelfTest` 的临时配置目录与历史库，
/// 不碰用户的历史库、Keychain、剪贴板。放在 `opsChecks` 之后：那里已经记了一条翻译。
enum DataSelfTest {
    static func run(_ engine: Engine, _ check: (String, Bool, String) -> Void) {
        let t = Translate(locale: .zhCN)
        do {
            let all = try engine.historyQuery(filter: HistoryFilter(query: ""), limit: 100, offset: 0)
            let matched = try engine.historyQuery(filter: HistoryFilter(query: "你好"), limit: 100, offset: 0)
            let none = try engine.historyQuery(filter: HistoryFilter(query: "没有这句"), limit: 100, offset: 0)
            let meta = all.first.map { HistoryFormat.recordMeta($0, t) } ?? ""
            check("history: 搜索", !all.isEmpty && matched.count == all.count && none.isEmpty
                && meta.contains("openai · gpt-4o-mini") && meta.contains("划词"),
                "空条件 \(all.count) 条、命中 \(matched.count)、无关词 \(none.count)；\(meta)")

            let quick = engine.quickState(paused: true)
            check("quickState", quick.paused && quick.providerLabel == "OpenAI" && quick.model == "gpt-4o-mini"
                && quick.recent.first?.translation == "你好世界",
                "暂停 \(quick.paused)、\(quick.providerLabel) · \(quick.model)、最近 \(quick.recent.count) 条")

            // 引导里存 Key 之后写的那一对，以及走完时的标记
            let engineChoice = Onboarding.engineForSavedKey(providerId: "deepseek", defaultModel: "deepseek-chat")
            let update = try engine.applySettingsPatch(patchJson: JSONValue.json([
                "providerId": .string(engineChoice.providerId), "model": .string(engineChoice.model),
            ]))
            let done = try engine.applySettingsPatch(patchJson: JSONValue.json(["onboardingDone": .bool(true)]))
            let values = JSONValue.object(json: done.settingsJson) ?? [:]
            check("onboarding: 写进设置", values.string("providerId") == "deepseek" && values.string("model") == "deepseek-chat"
                && !AppModel.needsOnboarding(settingsJson: done.settingsJson)
                && AppModel.needsOnboarding(settingsJson: #"{"onboardingDone":false}"#) && !update.hotkeysChanged,
                "deepseek · deepseek-chat，onboardingDone = \(values.bool("onboardingDone"))")
            // 换回来：后面没有别的项依赖它，但别把夹具留在一个奇怪的状态
            _ = try engine.applySettingsPatch(patchJson: #"{"providerId":"openai","model":"gpt-4o-mini"}"#)

            let removedOne = try engine.historyDelete(id: all[0].id)
            let cleared = try engine.historyClear()
            let left = try engine.historyQuery(filter: nil, limit: 10, offset: 0)
            check("history: 删除与清空", removedOne && left.isEmpty,
                  "删 1 条：\(removedOne)，再清空 \(cleared) 条，剩 \(left.count)")
        } catch {
            check("history / quick / onboarding", false, "\(error)")
        }
    }
}
