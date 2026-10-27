import Foundation
import UmuoCore

/// 撰写窗的纯规则：粘贴目标、请求的构造、给用户看的那几句话。Tauri 的 `compose_owner` /
/// `compose_owner_for_caller`（`main.rs`）与 `compose_translate` / `compose_back_translate` / `compose_commit`
/// （`commands.rs`）里不碰窗口的部分；验收用例在 Tests/UmuoTests/ComposeTests.swift。
enum ComposeRules {
    /// 停止输入多久后触发翻译（PRD §5.3：500 ms）。
    static let debounce: Duration = .milliseconds(500)

    // 下面两句是 Tauri 命令里写死的中文（不在文案表里），逐字一致。

    /// 文本为空（`commands.rs` 的 `EMPTY_TEXT`）。
    static let emptyText = "没有可翻译的内容"
    /// ⌘⇧↩ 没能确认原来的应用回到前台：只留在剪贴板里，不往不知道是谁的窗口里 ⌘V（审查 M19）。
    static let pasteNotBack = "译文已复制到剪贴板，但原来的应用没能回到前台，没有自动粘贴。可以手动 ⌘V。"

    /// 前台是 umuo 自己（从历史窗「再次编辑」、从设置窗里按快捷键）时没有外部粘贴目标（`compose_owner`）。
    static func owner(_ token: String?, own: String) -> String? {
        token.flatMap { $0 == own ? nil : $0 }
    }

    /// 「在撰写窗打开」：每次都按**这一次**的来源重新算粘贴目标，不保留旧值——撰写窗置顶、失焦不收起，
    /// 一直开着时旧值可能是很早以前唤出它的无关应用（`compose_owner_for_caller`）。
    ///
    /// - 调用方是浮窗（`panelOwner` 是浮窗归属）：原文来自那个应用，优先粘回那里；归属是 umuo 自己（截图翻译）
    ///   或还没取到时退回当前前台。
    /// - 其他 umuo 窗口（历史窗「再次编辑」）不带归属（nil）：只认当前前台的外部应用。浮窗收起后归属不清，
    ///   可能早已过时，不能拿来用——所以由调用方决定传不传，而不是这里去读浮窗。
    static func ownerForCaller(frontmost: String?, panelOwner: String?, own: String) -> String? {
        owner(panelOwner, own: own) ?? owner(frontmost, own: own)
    }

    /// 撰写窗这一次的临时选择。空串 = 用设置里的默认值。
    ///
    /// 它们只作用于**这一次**撰写，不写回设置。模型始终是设置里的当前模型。
    struct Overrides: Equatable, Sendable {
        var sourceLang = ""
        var targetLang = ""
    }

    /// 译文的请求（`compose_translate`）：交 trim 过的文本，原文只有空白时返回 nil。
    static func request(_ text: String, _ overrides: Overrides) -> TranslateRequest? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        func value(_ raw: String) -> String? { raw.isEmpty ? nil : raw }
        return TranslateRequest(text: trimmed, mode: .compose, targetOverride: value(overrides.targetLang),
                                sourceOverride: value(overrides.sourceLang), focusSource: nil)
    }
}
