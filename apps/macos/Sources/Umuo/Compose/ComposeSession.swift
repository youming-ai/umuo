import Foundation
import Observation
import UmuoCore

/// 撰写窗往外要做的事。正式实现是 `ComposeController`（Engine、剪贴板、AX、按键一律在后台做），
/// 测试换成只记调用的假实现——撰写窗的调度与提交规则因此不用真窗口、真 Engine 就能测。
@MainActor
protocol ComposeBackend: AnyObject {
    /// 开始一次翻译（主译文或回译）。事件经 sink 回到 `ComposeSession.apply`。
    /// 没能发出去（内核还没打开）时返回给用户看的话——那条路径不会有 done / error 事件。
    func translate(_ request: TranslateRequest) -> String?
    /// 提交：写剪贴板 → 收起撰写窗 →（`paste`）把唤出撰写窗之前的应用叫回前台、确认后再 ⌘V。
    /// 成功为 nil，失败返回原因。
    func commit(_ text: String, paste: Bool, owner: String?) async -> String?
    func hideCompose()
    /// 词卡上的朗读（撰写窗里打一个单词也会出词卡）。
    func speak(_ text: String)
}

/// 撰写窗的视图模型（PRD §5.3），`apps/desktop/src/compose.tsx` 的移植，语义逐条一致。
///
/// **输入框的内容是这里自己的状态**——它不能由 Engine 推来的 start 事件驱动，否则每翻译一次就会把
/// 用户正在打的字重置一遍。主译文区与回译区各用一份浮窗那套 reducer（`PanelModel`）：两者共用同一组事件，
/// 混在一起的话回译结果会覆盖主译文，⌘↩ 提交出去的就成了原语言（审查 M16）。
///
/// 只在 MainActor 上改。
@MainActor @Observable
final class ComposeSession {
    let main = PanelModel()
    let back = PanelModel()
    var state: PanelState { main.state }

    /// 输入框。改了就重新计时防抖（关掉自动翻译时不计）。
    var input = "" {
        didSet { if input != oldValue { scheduleDebounce() } }
    }

    var autoTranslate = true {
        didSet { if autoTranslate != oldValue { scheduleDebounce() } }
    }

    /// 语言 / 模型 / 风格（PRD §5.3）。改了也重新计时：Tauri 的防抖依赖里有 `send`，换一个下拉就按新选择再翻一次。
    var overrides = ComposeRules.Overrides() {
        didSet { if overrides != oldValue { scheduleDebounce() } }
    }

    /// 提交结果、回译失败这类一次性提示。
    var notice: String?
    var providers: [ProviderDetail] = []
    var styles: [StyleInfo] = []
    /// ⌘⇧↩ 要粘回的应用（pid）。每次唤出撰写窗时按来源重新算（`ComposeRules.ownerForCaller`），nil = 没有外部目标。
    var owner: String?
    var theme: ResolvedTheme = .dark
    var locale: AppLocale = .source
    var scale: Double = 1
    var metrics: Palette.Metrics { Palette.Metrics(scale: scale) }
    var t: Translate { Translate(locale: locale) }
    var palette: Palette { .of(theme) }

    weak var backend: ComposeBackend?

    /// 调度状态：参与的是时序决策，不需要触发渲染。
    @ObservationIgnored private(set) var queue = ComposeQueue.empty
    @ObservationIgnored private var debounceTask: Task<Void, Never>?
    /// 防抖间隔。测试传 0，免得等真实的 500 ms。
    @ObservationIgnored let debounceDelay: Duration
    /// 回译的目标语言从原文推断（Rust 的 `detectLanguage`）。测试可换。
    @ObservationIgnored var detect: (String) -> String? = { detectLanguage(text: $0) }

    init(backend: ComposeBackend? = nil, debounce: Duration = ComposeRules.debounce) {
        self.backend = backend
        debounceDelay = debounce
    }

    // MARK: - 防抖与调度

    /// 浮窗的「在撰写窗打开」：只把原文填进输入框，不直接翻译——交给防抖，避免同一次输入被翻两遍；
    /// 关掉了自动翻译时也不该被这个入口绕过。带过来的译文与 Tauri 一样不用（输入框才是撰写窗的状态）。
    func prefill(_ text: String) { input = text }

    /// 停止输入 500 ms 后才把文本交给调度器。
    private func scheduleDebounce() {
        debounceTask?.cancel()
        debounceTask = nil
        guard autoTranslate else { return }
        let delay = debounceDelay
        debounceTask = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            self?.flushInput()
        }
    }

    /// 防抖到点：当前输入交给调度器（翻译中就只排队）。
    func flushInput() {
        let decision = queue.onInput(input)
        queue = decision.queue
        if let start = decision.start { send(start) }
    }

    private func send(_ text: String) {
        guard let request = ComposeRules.request(text, overrides) else { return settle() }
        guard let failure = backend?.translate(request) else { return }
        // 没能发出去：没有 id，算作当前这次的结果。这条路径不会推 done / error 事件，
        // 调度器必须在这里自己收尾，否则会永远停在 streaming 上再也不翻译。
        main.apply(.error(PanelError(requestId: nil, message: failure, actions: [], needsPermission: false,
                                     permission: nil, source: nil)))
        settle()
    }

    /// 这一次结束了（done 或 error）。有排队就立刻发下一次。
    private func settle() {
        let decision = queue.onSettled()
        queue = decision.queue
        if let start = decision.start { send(start) }
    }

    // MARK: - 事件

    /// Engine 推来的事件：回译那条道只更新回译区，不碰主译文，也不推动调度队列。
    func apply(route: Route, event: TranslateEvent) {
        let action = PanelAction(route: route, event: event)
        if route.back {
            back.apply(action)
            return
        }
        main.apply(action)
        switch action {
        case let .start(start):
            // 主译文换了，旧的回译就不再对应它；比这次更早的回译事件也一并作废。
            back.apply(.reset(requestId: start.requestId))
        case .done, .error:
            settle()
        case .delta, .card, .reset:
            break
        }
    }

    // MARK: - 能做什么

    /// 只有完成的译文才能提交或回译：流式中途提交会把半截译文粘进聊天框（审查 M18）；
    /// 回译与主译文同在撰写窗这一个窗口上，流式中途发起回译会把还没翻完的主译文顶掉。
    var settled: Bool {
        state.status == .done && !state.translation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var canBackTranslate: Bool { settled && !state.source.isEmpty }

    // MARK: - 操作

    /// ⌘↩ 复制并关闭；⌘⇧↩ 复制并粘贴回唤出撰写窗之前的应用。两种都收起撰写窗（PRD §5.3）。
    func commit(paste: Bool) {
        guard settled, let backend else { return }
        let text = state.translation
        let owner = owner
        let t = t
        Task {
            if let failure = await backend.commit(text, paste: paste, owner: owner) {
                notice = t("compose.submitFailed", ["reason": failure])
            } else {
                notice = paste ? t("compose.copiedPasted") : t("compose.copied")
            }
        }
    }

    func backTranslate() {
        guard canBackTranslate else { return }
        switch ComposeRules.backRequest(source: state.source, translation: state.translation, detect: detect) {
        case let .failure(failure):
            notice = failure.message
        case let .success(request):
            if let failure = backend?.translate(request) { notice = failure }
        }
    }

    /// 出错块的「重试」：当前输入再走一次调度器。
    ///
    /// 与 Tauri 不同的一处：那边直接 `send(input)`、绕过了队列，紧接着的一次输入可能与它并发。
    func retry() { flushInput() }

    func speak(_ text: String) { backend?.speak(text) }

    /// Esc：收起（不取消：与 Tauri 一样，翻到一半的那次照常完成，下次唤出还在）。
    func escape() { backend?.hideCompose() }
}
