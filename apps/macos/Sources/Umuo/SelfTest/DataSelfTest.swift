import Foundation
import UmuoCore

/// 历史窗、快捷面板、首次引导从 Rust 拿到的东西，在 Swift 这边真的排得出来：
/// 带筛选的历史查询（AND）、记录的元信息与按日柱状图（`day` 是 `YYYY-MM-DD`，标签取得出 `MM-DD`）、本月用量一行、
/// 快捷面板的状态（暂停由宿主传入、最近一条就是刚才那次翻译）、引导写进去的 `providerId` + `model` 与 `onboardingDone`
/// 过得了 `applySettingsPatch`、删除与清空。
///
/// 视图模型的规则由 `swift test` 用假 backend 测；这里补的是两边对不对得上。只用 `EngineSelfTest` 的临时配置目录与历史库，
/// 不碰用户的历史库、Keychain、剪贴板。放在 `opsChecks` 之后：那里已经记了一条翻译、收藏了一条。
enum DataSelfTest {
    static func run(_ engine: Engine, _ check: (String, Bool, String) -> Void) {
        let t = Translate(locale: .zhCN)
        do {
            let all = try engine.historyQuery(filter: HistoryFilter(query: "", sourceApp: "", model: ""), limit: 100, offset: 0)
            let matched = try engine.historyQuery(filter: HistoryFilter(query: "你好", sourceApp: "", model: "gpt-4o-mini"),
                                                  limit: 100, offset: 0)
            let none = try engine.historyQuery(filter: HistoryFilter(query: "你好", sourceApp: "", model: "not-a-model"),
                                               limit: 100, offset: 0)
            let meta = all.first.map { HistoryFormat.recordMeta($0, t) } ?? ""
            check("history: 筛选", !all.isEmpty && matched.count == all.count && none.isEmpty
                && meta.contains("openai · gpt-4o-mini") && meta.contains("划词"),
                "空条件 \(all.count) 条、AND 命中 \(matched.count)、错模型 \(none.count)；\(meta)")

            let bars = HistoryFormat.dailyBars(try engine.usageDaily(days: UInt32(HistoryFormat.barWindowDays)))
            let line = HistoryFormat.usageLine(try engine.usageSummary(), t)
            let barOk = bars.count == 1 && bars[0].label.count == 5 && bars[0].ratio == 1
            check("history: 用量", barOk && line.hasPrefix("本月 "), "\(bars.map(\.label)) · \(line)")

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
            // 清空历史不动收藏（「收藏不受影响」那句提示）
            let favorites = try engine.favoritesList(limit: 10, offset: 0)
            check("history: 删除与清空", removedOne && left.isEmpty && !favorites.isEmpty,
                  "删 1 条：\(removedOne)，再清空 \(cleared) 条，剩 \(left.count)，收藏 \(favorites.count) 条")
        } catch {
            check("history / quick / onboarding", false, "\(error)")
        }
    }
}
