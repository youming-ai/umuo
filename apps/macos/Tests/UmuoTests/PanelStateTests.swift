import Testing
import UmuoCore
@testable import Umuo

// 浮窗状态机的验收用例。「事件被丢掉」用值相等断言（状态是 Equatable）。

/// 断言的是简体中文文案，与源语言一致。
private let t = Translate(locale: .zhCN)

private let start = PanelStart(requestId: 1, text: "Hello world", provider: "OpenAI", model: "gpt-4o-mini",
                               targetLang: "中文", wordMode: false, mode: .selection)

private let done = PanelDone(requestId: 1, model: "gpt-4o-mini", inputTokens: 120, outputTokens: 40, estimated: false,
                             firstTokenMs: 420, totalMs: 900, replaced: false, warning: nil)

private let failure = PanelError(requestId: 1, message: "请求过于频繁", actions: [.retry, .switchModel],
                                 needsPermission: false, permission: nil, source: nil)

private let card = WordCard(word: "hello", phonetic: "/həˈloʊ/", senses: [.init(partOfSpeech: "int.", definition: "你好")])

private func with<T>(_ value: T, _ change: (inout T) -> Void) -> T {
    var copy = value
    change(&copy)
    return copy
}

private func run(_ actions: PanelAction..., from state: PanelState = .initial) -> PanelState {
    actions.reduce(state) { $0.reduced($1) }
}

@Suite("panel reducer")
struct PanelReducerTests {
    @Test func startResetsEverythingFromThePreviousTranslation() {
        // 上一次的译文残留在这一次里，是浮窗最容易被漏掉的 bug。
        let fresh = run(.start(start), .delta(requestId: 1, text: "你好"), .start(with(start) { $0.text = "Another sentence" }))
        #expect(fresh.translation == "")
        #expect(fresh.source == "Another sentence")
        #expect(fresh.status == .streaming)
        #expect(fresh.metrics == nil)
        #expect(fresh.error == nil)
    }

    @Test func aRepeatedStartForTheSameRequestDropsTheFailedCandidatesPartialOutput() {
        // 故障转移换候选前，后端会用同一个请求 id 再发一次 start（PR #65 审查）。
        var state = run(.start(start), .delta(requestId: 1, text: "旧的第一片"),
                        .start(with(start) { $0.provider = "DeepSeek"; $0.model = "deepseek-chat" }))
        #expect(state.translation == "")
        #expect(state.status == .streaming)
        #expect(state.model == "deepseek-chat")
        state = state.reduced(.delta(requestId: 1, text: "新的全文"))
        #expect(state.translation == "新的全文")
    }

    @Test func accumulatesDeltasInOrderWhileStreaming() {
        #expect(run(.start(start), .delta(requestId: 1, text: "你"), .delta(requestId: 1, text: "好")).translation == "你好")
    }

    @Test func dropsLateDeltasAfterTheStreamHasFinished() {
        let state = run(.start(start), .delta(requestId: 1, text: "你好"), .done(done))
        let after = state.reduced(.delta(requestId: 1, text: "世界"))
        #expect(after == state)
        #expect(after.translation == "你好")
    }

    @Test func dropsLateDeltasAfterAnError() {
        let state = run(.start(start), .error(failure))
        #expect(state.reduced(.delta(requestId: 1, text: "x")) == state)
    }

    @Test func ignoresDoneWhenNoTranslationWasStarted() {
        #expect(PanelState.initial.reduced(.done(done)) == .initial)
    }

    @Test func reportsTheModelThatActuallyServed() {
        let state = run(.start(start), .done(with(done) { $0.model = "deepseek-chat" }))
        #expect(state.model == "deepseek-chat")
        #expect(state.statusLine(t) == "OpenAI · deepseek-chat · 中文")
    }

    @Test func surfacesActionableErrorsInsteadOfABareMessage() {
        let state = run(.start(start), .error(failure))
        #expect(state.status == .error)
        #expect(state.errorActions == [.retry, .switchModel])
    }

    private let screenRecording = PanelError(requestId: 1, message: "需要屏幕录制权限", actions: [],
                                             needsPermission: true, permission: .screenRecording, source: nil)

    @Test func recordsWhichPermissionIsMissing() {
        // 截图缺权限被引导到「辅助功能」，用户照做之后仍然用不了——比不提示更糟。
        #expect(run(.error(screenRecording)).permission == .screenRecording)
    }

    @Test func clearsThePermissionKindOnTheNextStart() {
        let state = run(.error(screenRecording), .start(start))
        #expect(state.permission == nil)
        #expect(state.needsPermission == false)
    }

    @Test func marksPermissionFailures() {
        let state = run(.error(PanelError(requestId: 1, message: "需要系统权限：辅助功能", actions: [],
                                          needsPermission: true, permission: .accessibility, source: nil)))
        #expect(state.needsPermission)
    }

    @Test func resetReturnsToThePristineState() {
        let state = run(.start(start), .delta(requestId: 1, text: "x"))
        #expect(state.reduced(.reset(requestId: nil)) == with(PanelState.initial) { $0.requestId = 1 })
    }
}

@Suite("metrics line")
struct MetricsLineTests {
    @Test func isAbsentUntilTheRequestCompletes() {
        #expect(metricsLine(nil, t) == nil)
    }

    @Test func showsTokensAndLatencyButNoCost() throws {
        let line = try #require(metricsLine(done, t))
        #expect(line.contains("120 → 40 tokens"))
        #expect(line.contains("首字 420ms"))
        #expect(!line.contains("$"), "费用估算已退出")
        #expect(!line.contains("无价格信息"))
    }

    @Test func labelsEstimatedUsage() {
        #expect(metricsLine(with(done) { $0.estimated = true }, t)?.contains("估算") == true)
    }

    @Test func fallsBackToTotalLatencyWhenThereWasNoStreamedFirstToken() throws {
        let line = try #require(metricsLine(with(done) { $0.firstTokenMs = nil }, t))
        #expect(line.contains("900ms"))
        #expect(!line.contains("首字"))
    }
}

@Suite("status line")
struct StatusLineTests {
    @Test func omitsMissingPartsRatherThanShowingSeparatorsForThem() {
        #expect(PanelState.initial.statusLine(t) == "")
        #expect(with(PanelState.initial) { $0.provider = "OpenAI" }.statusLine(t) == "OpenAI")
    }
}

@Suite("译文可能不完整的提醒")
struct WarningTests {
    @Test func 截断提醒随done一起到达且不算错误() {
        // 输出触到长度上限或连接中途断开时，Rust 在 Done 里带一句提醒（`done_warning`）
        let state = run(.start(start), .done(with(done) { $0.warning = "译文可能不完整：输出触到了模型的长度上限，或连接中途断开" }))
        #expect(state.status == .done)
        #expect(state.warning?.contains("不完整") == true)
    }

    @Test func 没有提醒时是nil() {
        #expect(run(.start(start), .done(done)).warning == nil)
    }

    @Test func 下一次start会清掉上一次的提醒() {
        #expect(run(.start(start), .done(with(done) { $0.warning = "超限" }), .start(start)).warning == nil)
    }
}

@Suite("单词词卡")
struct WordCardTests {
    @Test func 卡片事件写入状态() {
        let state = run(.start(with(start) { $0.text = "hello"; $0.wordMode = true }), .card(requestId: 1, card))
        #expect(state.card == card)
        #expect(state.wordMode)
    }

    @Test func 卡片之后到达的增量不进卡片() {
        let after = run(.start(start), .card(requestId: 1, card), .delta(requestId: 1, text: #"{"word""#))
        #expect(after.card == card)
    }

    @Test func 流已经结束之后到达的卡片被丢掉() {
        let state = run(.start(start), .done(done))
        #expect(state.reduced(.card(requestId: 1, card)) == state)
    }

    @Test func 下一次start会清掉上一张卡() {
        #expect(run(.start(start), .card(requestId: 1, card), .done(done), .start(start)).card == nil)
    }

    @Test func 解析失败降级时没有卡片走纯文本路径() {
        // PRD §6.5：词卡 JSON 解析失败时要降级为纯文本展示，而不是显示空白。
        let state = run(.start(with(start) { $0.wordMode = true }), .delta(requestId: 1, text: "抱歉，我无法返回 JSON"))
        #expect(state.card == nil)
        #expect(state.translation == "抱歉，我无法返回 JSON")
    }
}

@Suite("静默翻译（原地替换）")
struct SilentReplaceTests {
    let silentStart = with(start) { $0.mode = .silentReplace }

    @Test func 划词模式下不显示任何替换提示() {
        #expect(run(.start(start)).replaceNotice(t) == nil)
    }

    @Test func 静默模式翻译中就说明完成后会替换原处() {
        #expect(run(.start(silentStart)).replaceNotice(t) == "完成后会替换原处…")
    }

    @Test func 写回成功后明确说原文已替换() {
        let state = run(.start(silentStart), .delta(requestId: 1, text: "你好世界"), .done(with(done) { $0.replaced = true }))
        #expect(state.replaced)
        #expect(state.replaceNotice(t) == "原文已替换")
    }

    @Test func 写回被拦下时不谎称已替换() {
        let state = run(.start(silentStart), .done(done))
        #expect(!state.replaced)
        #expect(state.replaceNotice(t) == nil)
    }

    @Test func 报错时也不显示替换提示() {
        #expect(run(.start(silentStart), .error(failure)).replaceNotice(t) == nil)
    }

    @Test func 下一次start会把替换状态清干净() {
        let next = run(.start(silentStart), .done(with(done) { $0.replaced = true }), .start(start))
        #expect(!next.replaced)
        #expect(next.mode == .selection)
    }
}

@Suite("按请求 id 过滤事件（审查 M1 / M15）")
struct RequestIdTests {
    let newer = with(start) { $0.requestId = 2; $0.text = "Second" }

    @Test func 换模型重译后旧请求迟到的增量与完成都被丢掉() {
        let state = run(.start(start), .delta(requestId: 1, text: "旧"), .start(newer), .delta(requestId: 1, text: "旧尾巴"),
                        .done(done), .delta(requestId: 2, text: "新"))
        #expect(state.translation == "新")
        #expect(state.status == .streaming)
    }

    @Test func 比当前更旧的start被丢掉() {
        let state = run(.start(newer))
        #expect(state.reduced(.start(start)) == state)
    }

    @Test func 被顶掉的旧请求报的错被丢掉() {
        let state = run(.start(newer))
        #expect(state.reduced(.error(failure)) == state)
    }

    @Test func 当前请求出错时保留已经流出来的半段译文() {
        let state = run(.start(start), .delta(requestId: 1, text: "半段"), .error(failure))
        #expect(state.translation == "半段")
        #expect(state.source == "Hello world")
    }

    @Test func 没有start的新请求出错时清掉上一次的原文与译文() {
        // 在 A 翻出 X，切到 B 什么都没选就按快捷键：「没有选中文本」下面不能还挂着 X。
        let state = run(.start(start), .delta(requestId: 1, text: "X"), .done(done),
                        .error(with(failure) { $0.requestId = 2; $0.message = "没有选中文本" }))
        #expect(state.status == .error)
        #expect(state.translation == "")
        #expect(state.source == "")
        #expect(state.metrics == nil)
        #expect(state.requestId == 2)
    }

    @Test func 新请求出错时显示它自己的原文供重试使用() {
        let state = run(.start(start), .error(with(failure) { $0.requestId = 2; $0.source = "Second" }))
        #expect(state.source == "Second")
        #expect(state.translation == "")
    }

    @Test func 界面自己构造的错误算作当前这次() {
        let state = run(.start(start), .delta(requestId: 1, text: "半段"), .error(with(failure) { $0.requestId = nil }))
        #expect(state.translation == "半段")
        #expect(state.requestId == 1)
    }

    @Test func reset带上新的下限后更早请求的错误不会再冒出来() {
        let state = run(.start(start), .reset(requestId: 2))
        #expect(state.reduced(.error(failure)) == state)
    }

    @Test func reset不会把下限往回调() {
        let state = run(.start(with(start) { $0.requestId = 3 }), .reset(requestId: 2))
        #expect(state.requestId == 3)
        #expect(state.reduced(.error(with(failure) { $0.requestId = 2 })) == state)
    }
}

@Suite("retranslateMode（审查 L21）")
struct RetranslateModeTests {
    @Test func OCR结果窗的重译保住ocr模式() {
        #expect(run(.start(with(start) { $0.mode = .ocr })).retranslateMode == .ocr)
    }

    @Test func 其它模式交给后端默认值() {
        #expect(run(.start(start)).retranslateMode == nil)
        #expect(run(.start(with(start) { $0.mode = .silentReplace })).retranslateMode == nil)
    }
}

/// Engine 的事件经 `PanelAction(route:event:)` 换成动作：id 取自路由，认不出来的模式按划词算。
@Suite("事件换型与视图模型")
@MainActor
struct PanelModelTests {
    @Test func ffiEventsDriveTheModelAndStaleOnesAreReportedAsDropped() {
        let model = PanelModel()
        let route = Route(surface: "panel", requestId: 5)
        #expect(model.apply(route: route, event: .start(text: "hi", provider: "OpenAI", model: "m", targetLang: "中文",
                                                        wordMode: false, mode: "ocr")))
        #expect(model.state.mode == .ocr)
        #expect(model.apply(route: route, event: .delta(text: "你好")))
        let stale = Route(surface: "panel", requestId: 4)
        #expect(!model.apply(route: stale, event: .delta(text: "旧")))
        #expect(model.apply(route: route, event: .error(message: "缺权限", actions: [], needsPermission: true,
                                                        permission: "screenRecording", source: nil)))
        #expect(model.state.permission == .screenRecording)
        #expect(model.state.translation == "你好")
        #expect(PanelAction(route: route, event: .start(text: "", provider: "", model: "", targetLang: "", wordMode: false,
                                                        mode: "未来的模式")) == .start(PanelStart(
            requestId: 5, text: "", provider: "", model: "", targetLang: "", wordMode: false, mode: .selection)))
    }
}
