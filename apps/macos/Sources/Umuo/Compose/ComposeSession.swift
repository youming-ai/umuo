import Foundation
import Observation
import UmuoCore

/// 撰写窗往外要做的事。正式实现是 `ComposeController`（Engine、剪贴板、AX、按键一律在后台做），
/// 测试换成只记调用的假实现——撰写窗的调度与提交规则因此不用真窗口、真 Engine 就能测。
@MainActor
protocol ComposeBackend: AnyObject {
    /// 开始一次翻译。事件经 sink 回到 `ComposeSession.apply`。
    /// 没能发出去（内核还没打开）时返回给用户看的话——那条路径不会有 done / error 事件。
    func translate(_ request: TranslateRequest) -> String?
    /// 提交：写剪贴板 → 收起撰写窗 →（`paste`）把唤出撰写窗之前的应用叫回前台、确认后再 ⌘V。
    /// 成功为 nil，失败返回原因。
    func commit(_ text: String, paste: Bool, owner: String?) async -> String?
    func hideCompose()
    /// 词卡上的朗读（撰写窗里打一个单词也会出词卡）。
    func speak(_ text: String)
}

/// 撰写窗的视图模型（PRD §5.3），语义逐条一致。
///
/// **输入框的内容是这里自己的状态**——它不能由 Engine 推来的 start 事件驱动，否则每翻译一次就会把
/// 用户正在打的字重置一遍。译文区用浮窗那套 reducer（`PanelModel`）。回译与临时换模型已退出（第四批精简）。
///
/// 只在 MainActor 上改。
@MainActor @Observable
final class ComposeSession {
    let main = PanelModel()
    var state: PanelState { main.state }

    /// 输入框。改了就重新计时防抖（关掉自动翻译时不计）。
    var input = "" {
        didSet { if input != oldValue { scheduleDebounce() } }
    }

    var autoTranslate = true {
        didSet { if autoTranslate != oldValue { scheduleDebounce() } }
    }

    /// 源语言 / 目标语言（PRD §5.3）。改了也重新计时：换一个下拉就按新选择再翻一次。
    var overrides = ComposeRules.Overrides() {
        didSet { if overrides != oldValue { scheduleDebounce() } }
    }

    /// 当前译文是按哪一版原文与语言选择发出去的（发请求时记下）。提交前要和输入框比对：
    /// 改了原文、还在防抖或关着自动翻译时，译文区里的是上一版的结果，不能拿去提交。
    private(set) var sentText: String?
    private(set) var sentOverrides: ComposeRules.Overrides?

    /// 提交结果这类一次性提示。
    var notice: String?
    /// ⌘⇧↩ 要粘回的应用（pid）。每次唤出撰写窗时按来源重新算（`ComposeRules.ownerForCaller`），nil = 没有外部目标。
    var owner: String?
    var locale: AppLocale = .source
    var t: Translate { Translate(locale: locale) }

    weak var backend: ComposeBackend?

    /// 调度状态：参与的是时序决策，不需要触发渲染。
    @ObservationIgnored private(set) var queue = ComposeQueue.empty
    @ObservationIgnored private var debounceTask: Task<Void, Never>?
    /// 防抖间隔。测试传 0，免得等真实的 500 ms。
    @ObservationIgnored let debounceDelay: Duration

    init(backend: ComposeBackend? = nil, debounce: Duration = ComposeRules.debounce) {
        self.backend = backend
        debounceDelay = debounce
    }

    // MARK: - 防抖与调度

    /// 浮窗的「在撰写窗打开」：只把原文填进输入框，不直接翻译——交给防抖，避免同一次输入被翻两遍；
    /// 关掉了自动翻译时也不该被这个入口绕过。带过来的译文不用（输入框才是撰写窗的状态）。
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
        sentText = request.text
        sentOverrides = overrides
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

    /// Engine 推来的事件：更新译文区，done / error 推动调度队列。
    func apply(route: Route, event: TranslateEvent) {
        let action = PanelAction(route: route, event: event)
        main.apply(action)
        switch action {
        case .done, .error:
            settle()
        case .start, .delta, .card, .reset:
            break
        }
    }

    // MARK: - 能做什么

    /// 只有完成的、而且就是当前输入的译文才能提交：流式中途提交会把半截译文粘进聊天框（审查 M18）；
    /// 改了原文或语言之后，防抖期间、关着自动翻译时，译文区里还是上一版的结果，提交出去就错了。
    var settled: Bool {
        state.status == .done && !state.translation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && sentText == input.trimmingCharacters(in: .whitespacesAndNewlines) && sentOverrides == overrides
    }

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

    /// 「翻译」按钮与 ⌘T：不等防抖，当前输入马上交给调度器（翻译中就只排队）。
    /// 关掉自动翻译时这是唯一的翻译入口。
    func translateNow() {
        debounceTask?.cancel()
        debounceTask = nil
        flushInput()
    }

    /// 出错块的「重试」：当前输入再走一次调度器（不绕过队列，免得与紧接着的一次输入并发）。
    func retry() { flushInput() }

    func speak(_ text: String) { backend?.speak(text) }

    /// Esc：收起（不取消：翻到一半的那次照常完成，下次唤出还在）。
    func escape() { backend?.hideCompose() }
}
