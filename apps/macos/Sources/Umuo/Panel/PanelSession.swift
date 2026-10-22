import Foundation
import Observation
import UmuoCore

/// 浮窗往外要做的事：Engine、剪贴板、朗读、写回、别的窗口。正式实现是 `PanelController`（Engine 与 AX 一律在后台调），
/// 测试换成只记调用的假实现——浮窗的交互规则因此不用真窗口、真 Engine 就能测。
@MainActor
protocol PanelBackend: AnyObject {
    /// 开始一次翻译（重试、重译、换模型 / 风格）。事件经 sink 回到 `PanelSession.apply`。
    func translate(_ request: TranslateRequest)
    /// Esc：取消浮窗当前这次请求（只是浮窗，别的窗口不受影响）。
    func cancelTranslation()
    func hidePanel()
    /// 复制到剪贴板。失败返回给用户看的话。
    func copy(_ text: String) async -> String?
    func speak(_ text: String)
    func stopSpeaking()
    /// 切换收藏，返回切换之后的状态。
    func favoriteToggle(text: String, translation: String?) async throws -> Bool
    func favoriteStatus(_ text: String) async -> Bool
    /// 替换原文。成功为 nil，失败返回原因（已是完整的一句，例如「写回原文失败：…」）。
    func replace(_ text: String, owner: String?) async -> String?
    /// 「在撰写窗打开」。`owner` 是浮窗归属的源应用：撰写窗 ⌘⇧Enter 要优先粘回那里（`compose_owner_for_caller`）。
    func openCompose(text: String, translation: String?, owner: String?)
    func openSettings()
    func openSystemSettings(_ permission: PermissionKind)
}

/// 浮窗的视图模型：翻译状态（`PanelModel`）之外，窗口自己的那些一次性状态——钉住、收藏、提示、OCR 的可改原文、
/// 能换的模型与风格、这次翻译属于哪个应用。`apps/desktop/src/panel.tsx` 里 `useState` 的那几项，语义逐条一致。
///
/// 只在 MainActor 上改；要等的操作（收藏、复制、替换）由 backend 在后台做完再回来。
@MainActor @Observable
final class PanelSession {
    let model = PanelModel()
    var state: PanelState { model.state }

    /// 钉住是**运行时窗口状态**，不是设置项：它描述「这一个浮窗现在要不要赖着不走」，重启后回到默认。
    var pinned = false
    var favorited = false
    /// 一次性提示（替换结果、正在换模型重译、操作失败的原因）。下一次 start 清掉。
    var actionNotice: String?
    /// OCR 结果窗的原文可以改了再翻（PRD §5.5）。识别错字是常态，逼用户重新框选一次是最没必要的摩擦。
    var draft = ""
    /// 「换个模型」能选的：这次真能用的供应商。读不到只是少了可选操作，不影响浮窗显示。
    var providers: [ProviderDetail] = []
    var styles: [StyleInfo] = []
    /// 这次翻译属于哪个前台应用（pid）。看门狗据此判断用户是否切走；「替换原文」写回它。
    /// 本应用自己的 pid = 没有源应用（截图 OCR）。nil = 还没取到，看门狗不收起。
    var owner: String?
    var theme: ResolvedTheme = .dark
    var locale: AppLocale = .source
    /// 设置的「界面缩放」（`uiScale`），每次显示时与主题、语言一起重读。
    var scale: Double = 1
    var metrics: Palette.Metrics { Palette.Metrics(scale: scale) }
    var t: Translate { Translate(locale: locale) }
    var palette: Palette { .of(theme) }

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
        return true
    }

    /// 一次新的结果开始了：可改的原文换成这次的，上一次的提示清掉，查一次这段是否已收藏
    /// （避免按钮显示错的初始状态）。查询回来时已经换成别的请求了就不认。
    private func started(_ start: PanelStart) {
        draft = start.text
        actionNotice = nil
        favorited = false
        let id = start.requestId
        Task {
            let value = await backend?.favoriteStatus(start.text) ?? false
            if state.requestId == id { favorited = value }
        }
    }

    // MARK: - 能做什么（按钮的显示条件，与 panel.tsx 一致）

    /// 流式中途的半截译文不能拿去复制或替换（审查 M18）；出错时的译文可能是上一段的残留（审查 M15）。
    var canCopy: Bool { !state.translation.isEmpty && state.status != .streaming }
    var canReplace: Bool { !state.translation.isEmpty && state.status == .done }
    /// 流式中途收藏会存下半截译文（审查 L23）。
    var canFavorite: Bool { state.status != .streaming }
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

    /// 翻译中按 Esc = 取消请求；空闲时按 Esc = 收起浮窗。
    func escape() {
        if state.status == .streaming { backend?.cancelTranslation() } else { backend?.hidePanel() }
    }

    func togglePin() { pinned.toggle() }

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

    func toggleFavorite() {
        guard canFavorite else { return }
        let source = state.source
        let translation = state.favoriteTranslation
        Task {
            guard let backend else { return }
            do { favorited = try await backend.favoriteToggle(text: source, translation: translation) } catch {
                actionNotice = userMessage(error)
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
                actionNotice = "没有可翻译的文本"
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

    /// 「换个模型」：只影响这一次请求，不写回设置。
    func switchModel(_ provider: ProviderDetail) {
        actionNotice = t("panel.switchingModel", ["provider": provider.label])
        retranslate(state.source, mode: state.retranslateMode, provider: provider.id, model: provider.defaultModel)
    }

    func switchStyle(_ styleId: String) {
        guard !styleId.isEmpty else { return }
        actionNotice = t("panel.switchingStyle")
        retranslate(state.source, mode: state.retranslateMode, style: styleId)
    }

    private func retranslate(_ text: String, mode: PanelMode?, provider: String? = nil, model: String? = nil,
                             style: String? = nil)
    {
        guard let request = Self.request(text, mode: mode, provider: provider, model: model, style: style) else {
            actionNotice = Self.emptyText
            return
        }
        backend?.translate(request)
    }

    /// 与 Tauri 的 `retranslate` 命令同一句（空原文时）。
    static let emptyText = "没有可翻译的内容"

    /// 浮窗发起的翻译请求（`Request::retranslate` 交 trim 过的原文，`Request::selection` 原样）。
    /// 原文只有空白返回 nil。模式只放行 ocr 与划词（`retranslate_mode`）：静默替换与撰写有自己的入口，不该从浮窗重放。
    static func request(_ text: String, mode: PanelMode?, provider: String? = nil, model: String? = nil,
                        style: String? = nil, trim: Bool = true) -> TranslateRequest?
    {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        return TranslateRequest(text: trim ? trimmed : text, mode: mode == .ocr ? .ocr : .selection, targetOverride: nil,
                                providerOverride: provider, modelOverride: model, styleOverride: style,
                                sourceOverride: nil, focusSource: nil, back: false)
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
