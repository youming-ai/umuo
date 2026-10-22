import Foundation
import UmuoCore

/// 撰写窗的纯规则：粘贴目标、请求的构造、给用户看的那几句话。Tauri 的 `compose_owner` /
/// `compose_owner_for_caller`（`main.rs`）与 `compose_translate` / `compose_back_translate` / `compose_commit`
/// （`commands.rs`）里不碰窗口的部分，逐条照搬；验收用例在 Tests/UmuoTests/ComposeTests.swift。
enum ComposeRules {
    /// 停止输入多久后触发翻译（PRD §5.3：500 ms）。
    static let debounce: Duration = .milliseconds(500)

    // 下面三句是 Tauri 命令里写死的中文（不在文案表里），逐字一致。

    /// 文本为空（`commands.rs` 的 `EMPTY_TEXT`）。
    static let emptyText = "没有可翻译的内容"
    /// 原文语言判断不出来时不硬猜回译的目标语言：猜错的语言会让回译结果毫无参考价值。
    static let backUnavailable = "无法判断原文语言，回译不可用"
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
    /// 它们只作用于**这一次**撰写，不写回设置：用户在撰写窗里试一下别的风格，不该改掉设置里的默认风格。
    struct Overrides: Equatable, Sendable {
        var sourceLang = ""
        var targetLang = ""
        var providerId = ""
        var styleId = ""
    }

    /// 主译文的请求（`compose_translate`）：交 trim 过的文本，原文只有空白时返回 nil。
    /// 模型只选供应商、不选具体模型（与 Tauri 一样传 null），由 Rust 取那家的默认模型。
    static func request(_ text: String, _ overrides: Overrides) -> TranslateRequest? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        func value(_ raw: String) -> String? { raw.isEmpty ? nil : raw }
        return TranslateRequest(text: trimmed, mode: .compose, targetOverride: value(overrides.targetLang),
                                providerOverride: value(overrides.providerId), modelOverride: nil,
                                styleOverride: value(overrides.styleId), sourceOverride: value(overrides.sourceLang),
                                focusSource: nil, back: false)
    }

    /// 回译：把译文翻回**原文的语言**，让用户自检（PRD §5.3，`compose_back_translate`）。
    ///
    /// 目标语言从原文推断（`detect` 是 Rust 的 `detectLanguage`），而不是取界面上的选择——
    /// 「原文是什么语言」这个判断只该有一处。失败时返回给用户看的那句话。
    static func backRequest(source: String, translation: String,
                            detect: (String) -> String?) -> Result<TranslateRequest, Failure>
    {
        let translated = translation.trimmingCharacters(in: .whitespacesAndNewlines)
        if translated.isEmpty { return .failure(Failure(emptyText)) }
        guard let language = detect(source) else { return .failure(Failure(backUnavailable)) }
        return .success(TranslateRequest(text: translated, mode: .compose, targetOverride: language,
                                         providerOverride: nil, modelOverride: nil, styleOverride: nil,
                                         sourceOverride: nil, focusSource: nil, back: true))
    }

    /// 一句给用户看的失败说明。
    struct Failure: Error, Equatable {
        let message: String
        init(_ message: String) { self.message = message }
    }
}
