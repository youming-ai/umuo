import Foundation
import Observation
import UmuoCore

/// 快捷面板往外要做的事。正式实现在 `QuickPanelController`，测试换成只记调用的假实现。
@MainActor
protocol QuickBackend: AnyObject {
    /// 面板一次要用的全部状态（当前模型、最近翻译、暂停没有）。内核没打开时抛出原因。
    func state() async throws -> QuickState
    /// 暂停 / 恢复全局快捷键。返回切换后的状态。
    func setPaused(_ paused: Bool) -> Bool
    /// 复制到剪贴板。失败返回原因。
    func copy(_ text: String) async -> String?
    func openSettings()
    func openHistory()
}

/// 菜单栏快捷面板（PRD §7.1）的视图模型：暂停 / 恢复、当前模型、最近翻译。
/// 快速输入与撰写窗重复，已退出（第五批精简）。
///
/// 这是一个可以反复开关的面板：**每次显示都重新拉一次状态**，否则「当前模型」会一直停在上次打开时的值。
@MainActor @Observable
final class QuickModel {
    let backend: QuickBackend
    private(set) var state: QuickState?
    var notice: String?
    /// 用户在这次打开期间切过的暂停状态：以它为准。面板打开时的读取是异步的，读取途中切了开关，
    /// 晚到的旧结果不能把它盖回去；第一次读取失败（`state` 还是 nil）时也要能显示切换后的状态。
    private(set) var pausedOverride: Bool?
    /// 切换次数：判断一次读取期间有没有切过开关。
    @ObservationIgnored private var toggles = 0

    var t = Translate(locale: .source)

    init(backend: QuickBackend) {
        self.backend = backend
    }

    var paused: Bool { pausedOverride ?? state?.paused ?? false }

    /// 「当前模型」那一行；还没读到时是省略号。
    var modelLine: String {
        guard let state else { return "…" }
        return "\(state.providerLabel) · \(state.model.isEmpty ? t("quick.modelUnset") : state.model)"
    }

    /// 显示时刷新。第一次读不到要说出原因；之后的刷新失败不打扰（面板上的旧值仍然有用）。
    func refresh() async {
        let before = toggles
        do {
            var fresh = try await backend.state()
            if toggles == before {
                // 读取期间没切过：读到的就是最新状态
                pausedOverride = nil
            } else if let pausedOverride {
                fresh.paused = pausedOverride
            }
            state = fresh
        } catch {
            if state == nil { notice = t("quick.unavailable", ["reason": SettingsRules.message(error)]) }
        }
    }

    func togglePause() {
        let now = backend.setPaused(!paused)
        toggles += 1
        pausedOverride = now
        state?.paused = now
    }

    func copy(_ record: QuickRecord) async {
        notice = await backend.copy(record.translation) ?? t("quick.copied")
    }
}
