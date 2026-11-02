import Foundation
import Observation
import UmuoCore

/// 浮窗往外要做的事：Engine、剪贴板、朗读、写回、别的窗口。正式实现是 `PanelController`（Engine 与 AX 一律在后台调），
/// 测试换成只记调用的假实现——浮窗的交互规则因此不用真窗口、真 Engine 就能测。
@MainActor
protocol PanelBackend: AnyObject {
    /// 开始一次翻译（重试、OCR 改原文重译）。事件经 sink 回到 `PanelSession.apply`。
    func translate(_ request: TranslateRequest)
    /// Esc：取消浮窗当前这次请求（只是浮窗，别的窗口不受影响）。
    func cancelTranslation()
    /// 按当前钉住与请求状态同步全局 Esc 热键（钉住且空闲时释放全局 Esc，免得吞掉别的应用的按键）。
    func syncEscape()
    func hidePanel()
    /// 复制到剪贴板。失败返回给用户看的话。
    func copy(_ text: String) async -> String?
    func speak(_ text: String)
    func stopSpeaking()
    /// 替换原文。成功为 nil，失败返回原因（已是完整的一句，例如「写回原文失败：…」）。
    func replace(_ text: String, owner: String?) async -> String?
    /// 「在撰写窗打开」。`owner` 是浮窗归属的源应用：撰写窗 ⌘⇧Enter 要优先粘回那里（`compose_owner_for_caller`）。
    func openCompose(text: String, translation: String?, owner: String?)
    func openSettings()
    func openSystemSettings(_ permission: PermissionKind)
}

extension PanelBackend {
    func syncEscape() {}
}

/// 浮窗的视图模型：翻译状态（`PanelModel`）之外，窗口自己的那些一次性状态——钉住、提示、OCR 的可改原文、
/// 这次翻译属于哪个应用。收藏与临时换模型已退出（第四批精简）。
///
/// 只在 MainActor 上改；要等的操作（复制、替换）由 backend 在后台做完再回来。
@MainActor @Observable
final class PanelSession {
    let model = PanelModel()
    var state: PanelState { model.state }

    /// 钉住是**运行时窗口状态**，不是设置项：它描述「这一个浮窗现在要不要赖着不走」，重启后回到默认。
    var pinned = false
    /// 一次性提示（替换结果、操作失败的原因）。下一次 start 清掉。
    var actionNotice: String?
    /// OCR 结果窗的原文可以改了再翻（PRD §5.5）。识别错字是常态，逼用户重新框选一次是最没必要的摩擦。
    var draft = ""
    /// 非 OCR 的原文默认只显示三行；长原文要能展开看全，才能和译文逐句对照。每次新的翻译开始时收回。
    var sourceExpanded = false
    /// 原文在三行内放不下（由视图实测后写回），只有这时才给「展开原文」。
    var sourceTruncated = false
    /// 这次翻译属于哪个前台应用（pid）。看门狗据此判断用户是否切走；「替换原文」写回它。
    /// 本应用自己的 pid = 没有源应用（截图 OCR）。nil = 还没取到，看门狗不收起。
    var owner: String?
    var locale: AppLocale = .source
    var t: Translate { Translate(locale: locale) }

    weak var backend: PanelBackend?

    init(backend: PanelBackend? = nil) {
        self.backend = backend
    }

    // MARK: - 事件

    /// Engine 推来的事件。被当作过期事件丢掉时返回 false。
    @discardableResult
    func apply(route: Route, event: TranslateEvent) -> Bool {
        apply(PanelAction(route: route, event: event))
    }

    @discardableResult
    func apply(_ action: PanelAction) -> Bool {
        guard model.apply(action) else { return false }
        if case let .start(start) = action { started(start) }
        backend?.syncEscape()
        return true
    }

    /// 一次新的结果开始了：可改的原文换成这次的，上一次的提示清掉。
    private func started(_ start: PanelStart) {
        draft = start.text
        actionNotice = nil
        sourceExpanded = false
    }

    // MARK: - 能做什么（按钮的显示条件，与 panel.tsx 一致）

    /// 流式中途的半截译文不能拿去复制或替换（审查 M18）；出错时的译文可能是上一段的残留（审查 M15）。
    var canCopy: Bool { !state.translation.isEmpty && state.status != .streaming }
    var canReplace: Bool { !state.translation.isEmpty && state.status == .done }
    /// 只有 OCR 结果窗的原文可编辑：划词路径里改原文没有意义（那段文字还在用户自己的文档里）。
    var editableSource: Bool { state.mode == .ocr }
    var canRetranslateDraft: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft != state.source
    }

    /// 有原文或译文时才有底部的朗读与操作两行。
    var hasContent: Bool { !state.source.isEmpty || !state.translation.isEmpty }

    /// 出错块里要不要给「打开模型设置」：换模型、去设置、用本机模型三种建议都送去同一个地方。
    var offersModelSettings: Bool {
        state.errorActions.contains { [.switchModel, .openModelSettings, .useLocalModel].contains($0) }
    }

    var errorText: String? {
        guard state.status == .error else { return nil }
        if state.needsPermission, state.error?.isEmpty ?? true { return t("panel.noPermission") }
        return state.error
    }

    // MARK: - 操作

    /// 是否需要全局拦截 Esc：未钉住时按 Esc 收起浮窗，流式翻译中按 Esc 取消请求；
    /// 已钉住且不在流式请求中时不抢全局 Esc，避免吞掉其他前台应用的 Esc 或误关已钉住的浮窗。
    var capturesGlobalEscape: Bool { !pinned || state.status == .streaming }

    /// 翻译中按 Esc = 取消请求；空闲时按 Esc = 收起浮窗。
    func escape() {
        if state.status == .streaming { backend?.cancelTranslation() } else { backend?.hidePanel() }
    }

    func togglePin() {
        pinned.toggle()
        backend?.syncEscape()
    }

    func copy() {
        guard canCopy else { return }
        let text = state.translation
        Task {
            if let failure = await backend?.copy(text) { actionNotice = failure }
        }
    }

    func speak(_ text: String) { backend?.speak(text) }
    func stopSpeaking() { backend?.stopSpeaking() }

    func replace() {
        guard canReplace else { return }
        let text = state.translation
        let owner = owner
        Task {
            guard let backend else { return }
            if let reason = await backend.replace(text, owner: owner) {
                actionNotice = t("panel.replaceFailed", ["reason": reason])
            } else {
                actionNotice = t("panel.replaced")
            }
        }
    }

    func openCompose() {
        backend?.openCompose(text: state.source, translation: state.translation, owner: owner)
    }

    func openSettings() { backend?.openSettings() }

    func openSystemSettings() {
        // 屏幕录制与辅助功能是两个不同的面板。送去错的那个，用户照做之后功能仍然不可用——比不提示更糟。
        backend?.openSystemSettings(state.permission == .screenRecording ? .screenRecording : .accessibility)
    }

    /// 出错块的「重试」：OCR 结果窗要保住 ocr 模式（审查 L21），划词路径与首次翻译一致。
    func retry() {
        if state.retranslateMode == .ocr {
            retranslate(state.source, mode: .ocr)
        } else {
            // `translate_text`：只查空白，原文原样交给流水线
            guard !state.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                actionNotice = t("common.nothingToTranslate")
                return
            }
            if let request = Self.request(state.source, mode: nil, trim: false) { backend?.translate(request) }
        }
    }

    /// OCR 结果窗改了原文之后重译。带上 ocr 模式：否则重译结果回来时原文又变回只读——这个功能就只能用一次。
    func retranslateDraft() {
        guard canRetranslateDraft else { return }
        retranslate(draft, mode: .ocr)
    }

    private func retranslate(_ text: String, mode: PanelMode?) {
        guard let request = Self.request(text, mode: mode) else {
            actionNotice = t("common.nothingToTranslate")
            return
        }
        backend?.translate(request)
    }

    /// 浮窗发起的翻译请求：改过原文后重译（OCR 结果窗）交 trim 过的原文，重试划词时原样交出。
    /// 原文只有空白返回 nil。模式只放行 ocr 与划词（`retranslate_mode`）：静默替换与撰写有自己的入口，不该从浮窗重放。
    static func request(_ text: String, mode: PanelMode?, trim: Bool = true) -> TranslateRequest? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        return TranslateRequest(text: trim ? trimmed : text, mode: mode == .ocr ? .ocr : .selection, targetOverride: nil,
                                sourceOverride: nil, focusSource: nil)
    }
}

/// Engine 方法的失败给用户看的那句话（`EngineError` 的文案本来就是中文，原样显示）。
func userMessage(_ error: Error) -> String {
    switch error {
    case let EngineError.Open(message), let EngineError.InvalidSetting(message), let EngineError.Failed(message):
        message
    default:
        "\(error)"
    }
}
