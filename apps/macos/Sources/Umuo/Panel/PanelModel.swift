import Foundation
import Observation
import UmuoCore

// 浮窗（以及撰写窗的主译文区与回译区）的状态机，语义逐条一致。
//
// 抽成纯函数是为了能测：浮窗最烦人的 bug 都是「流结束之后还在追加增量」或者「上一次翻译的增量污染了下一次」
// 这类时序问题，在真实界面里很难复现，在纯 reducer 里是一行断言的事。
// 验收用例在 Tests/UmuoTests/PanelStateTests.swift（由 panel-state.test.ts 逐条改写）。

enum PanelStatus: Equatable, Sendable { case idle, streaming, done, error }

/// 这次翻译的用途（事件里的 `mode` 字符串）。认不出来的值按划词算，与后端默认值一致。
enum PanelMode: String, Equatable, Sendable {
    case selection, silentReplace, compose, ocr
}

/// 缺的是哪一个权限——浮窗据此把用户送去正确的设置面板。
enum PermissionKind: String, Equatable, Sendable {
    case accessibility, screenRecording
}

/// 单词词卡（PRD §5.2）。
struct WordCard: Equatable {
    struct Sense: Hashable { let partOfSpeech: String; let definition: String }
    struct Example: Hashable { let source: String; let target: String }

    let word: String
    let phonetic: String?
    let senses: [Sense]
    let forms: [String]
    let examples: [Example]
}

struct PanelStart: Equatable {
    var requestId: UInt64
    var text: String
    var provider: String
    var model: String
    var targetLang: String
    var wordMode: Bool
    var mode: PanelMode
}

/// 完成事件，也是费用行要的计量（TS 的 `DonePayload`）。
struct PanelDone: Equatable {
    var requestId: UInt64
    var model: String
    var inputTokens: UInt32
    var outputTokens: UInt32
    var estimated: Bool
    var costUsd: Double?
    var firstTokenMs: UInt64?
    var totalMs: UInt64
    var replaced: Bool
    var warning: String?
    var offline: Bool
}

struct PanelError: Equatable {
    /// 为空 = 界面自己构造的错误，算作当前这次。
    var requestId: UInt64?
    var message: String
    var actions: [SuggestedAction]
    var needsPermission: Bool
    var permission: PermissionKind?
    var source: String?
}

enum PanelAction: Equatable {
    case start(PanelStart)
    case delta(requestId: UInt64, text: String)
    case card(requestId: UInt64, WordCard)
    case done(PanelDone)
    case error(PanelError)
    /// 清空回初始状态。`requestId` 是新的下限：id 不大于它的事件都算过期。
    /// 不给就沿用当前的——清空不该让已经被顶掉的旧请求重新「复活」。
    case reset(requestId: UInt64?)

    /// Engine 推来的事件 → 动作。事件属于哪次请求看 `route.requestId`。
    init(route: Route, event: TranslateEvent) {
        let id = route.requestId
        switch event {
        case let .start(text, provider, model, targetLang, wordMode, mode):
            self = .start(PanelStart(requestId: id, text: text, provider: provider, model: model,
                                     targetLang: targetLang, wordMode: wordMode,
                                     mode: PanelMode(rawValue: mode) ?? .selection))
        case let .delta(text):
            self = .delta(requestId: id, text: text)
        case let .card(word, phonetic, senses, forms, examples):
            self = .card(requestId: id, WordCard(
                word: word, phonetic: phonetic,
                senses: senses.map { .init(partOfSpeech: $0.partOfSpeech, definition: $0.definition) },
                forms: forms,
                examples: examples.map { .init(source: $0.source, target: $0.target) }
            ))
        case let .done(warning, model, inputTokens, outputTokens, estimated, costUsd, firstTokenMs, totalMs, replaced, offline):
            self = .done(PanelDone(requestId: id, model: model, inputTokens: inputTokens, outputTokens: outputTokens,
                                   estimated: estimated, costUsd: costUsd, firstTokenMs: firstTokenMs, totalMs: totalMs,
                                   replaced: replaced, warning: warning, offline: offline))
        case let .error(message, actions, needsPermission, permission, source):
            self = .error(PanelError(requestId: id, message: message, actions: actions, needsPermission: needsPermission,
                                     permission: permission.flatMap(PermissionKind.init(rawValue:)), source: source))
        }
    }
}

struct PanelState: Equatable {
    var status: PanelStatus = .idle
    /// 正在显示的是哪一次请求。0 = 还没有过请求（后端的 id 从 1 起）。
    ///
    /// 增量、词卡、完成只认这个 id；被顶掉的旧请求迟到的事件一律丢掉——
    /// 否则换模型重译时两路译文会交错拼在一起（审查 M1）。
    var requestId: UInt64 = 0
    /// 原文（用于对照与小字展示）。
    var source = ""
    /// 已累计的译文。
    var translation = ""
    var provider = ""
    var model = ""
    var targetLang = ""
    var wordMode = false
    /// 这次翻译的用途：只显示，还是把结果写回原处。
    var mode: PanelMode = .selection
    /// 译文是否已经写回原处。
    var replaced = false
    /// 离线用本机模型翻的（PRD §7.5）。
    var offline = false
    /// 单词词卡。有值时就该渲染卡片而不是纯文本译文（PRD §5.2）。
    var card: WordCard?
    /// 结果之外要说的那句话（超限、换供应商）。翻译是成功的，不是错误。
    var warning: String?
    var error: String?
    var errorActions: [SuggestedAction] = []
    /// 缺权限这类错误要显示「去开权限」而不是「重试」。
    var needsPermission = false
    var permission: PermissionKind?
    var metrics: PanelDone?

    static let initial = PanelState()

    /// 纯函数：事件 → 新状态。被丢掉的事件原样返回当前状态。
    func reduced(_ action: PanelAction) -> PanelState {
        switch action {
        case let .start(start):
            // 比当前还旧的 start：那次请求在发出 start 之前就已经被新请求顶掉了。
            if start.requestId < requestId { return self }
            // 每次 start 都整体重置：上一次翻译的译文绝不能残留进这一次。
            // 同一 id 再来一次 start = 故障转移换了候选，同样整体重置（ARCHITECTURE §2.2）。
            var next = PanelState.initial
            next.requestId = start.requestId
            next.status = .streaming
            next.source = start.text
            next.provider = start.provider
            next.model = start.model
            next.targetLang = start.targetLang
            next.wordMode = start.wordMode
            next.mode = start.mode
            return next

        case let .delta(id, text):
            // 只在 streaming 状态下追加：完成或报错之后迟到的增量必须被丢掉，
            // 否则用户会看到「译文在报错信息后面又冒出来一截」。
            guard id == requestId, status == .streaming else { return self }
            var next = self
            next.translation += text
            return next

        case let .card(id, card):
            // 词卡与增量互斥（后端在词卡模式下抑制了 delta），所以直接覆盖。
            guard id == requestId, status == .streaming else { return self }
            var next = self
            next.card = card
            return next

        case let .done(done):
            guard done.requestId == requestId, status == .streaming else { return self }
            var next = self
            next.status = .done
            // 提醒跟着结果一起到达；下一次 start 会把它清掉。
            next.warning = done.warning
            // 故障转移后实际服务的模型可能与 start 时说的不同，以 done 为准。
            next.model = done.model
            next.replaced = done.replaced
            next.offline = done.offline
            next.metrics = done
            return next

        case let .error(error):
            let id = error.requestId ?? requestId
            // 被顶掉的旧请求报的错（典型是「已取消」）：用户已经在看新的那次了。
            if id < requestId { return self }
            // 当前这次出错：保留已经流出来的半段译文，它对用户仍有价值。
            // 更新的请求在 start 之前就失败了（取词失败、黑名单、缺 Key…）：先清空，
            // 否则上一次的原文和译文还挂在下面，「替换原文」会把旧译文写进新的应用（审查 M15）。
            // 原文换成出错的这次请求自己的（有的话），「重试」才有东西可翻。
            var next = self
            if id != requestId {
                next = .initial
                next.requestId = id
                next.source = error.source ?? ""
            }
            next.status = .error
            next.error = error.message
            next.errorActions = error.actions
            next.needsPermission = error.needsPermission
            next.permission = error.permission
            return next

        case let .reset(floor):
            // 下限只升不降：一个迟到的旧 start 触发的 reset 不能把已经作废的请求放回来。
            var next = PanelState.initial
            next.requestId = max(requestId, floor ?? 0)
            return next
        }
    }

    /// 状态行：把「谁在翻、翻成什么」用一行说清。
    ///
    /// 离线回落时**不能**沿用 start 里的供应商名：那是原来那家云端厂商，而实际服务的是本机模型。
    func statusLine(_ t: Translate) -> String {
        let source = offline ? t("panel.offline") : provider
        return [source, model, targetLang].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// 静默翻译要显式告诉用户「原文已经被换掉了」；写回被拦下时也不能谎称已替换。
    func replaceNotice(_ t: Translate) -> String? {
        guard mode == .silentReplace else { return nil }
        switch status {
        case .streaming: return t("panel.replaceOnDone")
        case .done: return replaced ? t("panel.sourceReplaced") : nil
        // 出错时不显示「已替换」：写回失败或目标已变都不会改动原文。
        case .idle, .error: return nil
        }
    }

    /// 重试 / 换模型 / 换风格要带上的模式。只有 OCR 要保住（结果窗的原文可编辑，审查 L21），
    /// 其余交给后端默认值——静默替换、撰写都有自己的入口，不该从浮窗重放。
    var retranslateMode: PanelMode? { mode == .ocr ? .ocr : nil }

    /// 收藏时要存的译文：流式中途不存半截，词卡模式没有纯文本译文——都是 nil 而不是空串（审查 L23）。
    var favoriteTranslation: String? {
        if status == .streaming { return nil }
        return translation.isEmpty ? nil : translation
    }
}

/// 计量文案的几段（浮窗与对比窗共用同一组文案，审查 L24：两处说的是同一组指标，措辞不该分叉）。
enum MetricsText {
    static func tokens(_ input: UInt32, _ output: UInt32, estimated: Bool, _ t: Translate) -> String {
        t("panel.tokens", ["input": "\(input)", "output": "\(output)", "estimated": estimated ? t("panel.estimated") : ""])
    }

    /// 价格表里没有这个模型时**明确说不知道**，不编数字。
    static func cost(_ costUsd: Double?, _ t: Translate) -> String {
        costUsd.map { "$" + String(format: "%.4f", $0) } ?? t("panel.noPrice")
    }

    static func latency(firstTokenMs: UInt64?, totalMs: UInt64, _ t: Translate) -> String {
        guard let first = firstTokenMs else { return t("panel.latencyTotal", ["total": "\(totalMs)"]) }
        return t("panel.latency", ["first": "\(first)", "total": "\(totalMs)"])
    }
}

/// 费用行：`tokens · cost · latency`。请求完成之前没有。
func costLine(_ metrics: PanelDone?, _ t: Translate) -> String? {
    guard let metrics else { return nil }
    return [
        MetricsText.tokens(metrics.inputTokens, metrics.outputTokens, estimated: metrics.estimated, t),
        MetricsText.cost(metrics.costUsd, t),
        MetricsText.latency(firstTokenMs: metrics.firstTokenMs, totalMs: metrics.totalMs, t),
    ].joined(separator: " · ")
}

/// 浮窗的视图模型：持有状态，按 `requestId` 丢弃旧事件。
///
/// 只在 MainActor 上改。Engine 的 sink 在 Rust 工作线程上只把事件 `yield` 进 `AsyncStream`，
/// 由窗口在 MainActor 上逐个 `for await` 取出来调 `apply`（ARCHITECTURE §2.3）。
@MainActor @Observable
final class PanelModel {
    private(set) var state = PanelState.initial

    /// 返回状态有没有变（被当作过期事件丢掉时为 false）。
    @discardableResult
    func apply(_ action: PanelAction) -> Bool {
        let next = state.reduced(action)
        guard next != state else { return false }
        state = next
        return true
    }

    @discardableResult
    func apply(route: Route, event: TranslateEvent) -> Bool {
        apply(PanelAction(route: route, event: event))
    }
}
