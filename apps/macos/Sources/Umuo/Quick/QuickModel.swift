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
    /// 走与划词完全相同的流水线，并收起面板。
    func translate(_ text: String) throws
    /// 复制到剪贴板。失败返回原因。
    func copy(_ text: String) async -> String?
    func openSettings()
    func openHistory()
}

/// 菜单栏快捷面板（PRD §7.1）的视图模型，`quick.tsx` 的状态与规则：暂停 / 恢复、当前模型、快速输入、最近翻译。
///
/// 这是一个可以反复开关的面板：**每次显示都重新拉一次状态**，否则「当前模型」会一直停在上次打开时的值。
@MainActor @Observable
final class QuickModel {
    let backend: QuickBackend
    private(set) var state: QuickState?
    var draft = ""
    var notice: String?

    var t = Translate(locale: .source)
    var theme = ResolvedTheme.light
    var palette: Palette { .of(theme) }

    init(backend: QuickBackend) {
        self.backend = backend
    }

    var paused: Bool { state?.paused ?? false }
    var canTranslate: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// 「当前模型」那一行；还没读到时是省略号。
    var modelLine: String {
        guard let state else { return "…" }
        return "\(state.providerLabel) · \(state.model.isEmpty ? t("quick.modelUnset") : state.model)"
    }

    /// 显示时刷新。第一次读不到要说出原因；之后的刷新失败不打扰（面板上的旧值仍然有用）。
    func refresh() async {
        do {
            state = try await backend.state()
        } catch {
            if state == nil { notice = t("quick.unavailable", ["reason": SettingsRules.message(error)]) }
        }
    }

    func togglePause() {
        let now = backend.setPaused(!paused)
        state?.paused = now
    }

    func translate() {
        guard canTranslate else { return }
        do { try backend.translate(draft) } catch { notice = SettingsRules.message(error) }
    }

    func copy(_ record: QuickRecord) async {
        notice = await backend.copy(record.translation) ?? t("quick.copied")
    }
}
