import Testing
import UmuoCore
@testable import Umuo

// 撰写窗：纯规则（`main.rs` 的 compose_owner 测试逐条改写、`commands.rs` 的请求构造）与视图模型的调度、回译、提交。
// backend 换成只记调用的假实现：不开窗口、不碰 Engine、剪贴板、AX，也不投递按键。

@MainActor
private final class FakeBackend: ComposeBackend {
    var translated: [TranslateRequest] = []
    var translateFailure: String?
    var commits: [(text: String, paste: Bool, owner: String?)] = []
    var commitFailure: String?
    var hidden = 0
    var spoken: [String] = []

    func translate(_ request: TranslateRequest) -> String? {
        translated.append(request)
        return translateFailure
    }

    func commit(_ text: String, paste: Bool, owner: String?) async -> String? {
        commits.append((text, paste, owner))
        return commitFailure
    }

    func hideCompose() { hidden += 1 }
    func speak(_ text: String) { spoken.append(text) }
}

private func route(_ id: UInt64) -> Route { Route(surface: "compose", requestId: id) }

private func start(_ text: String) -> TranslateEvent {
    .start(text: text, provider: "OpenAI", model: "gpt-4o-mini", targetLang: "en", wordMode: false, mode: "compose")
}

private let doneEvent = TranslateEvent.done(warning: nil, model: "gpt-4o-mini", inputTokens: 1, outputTokens: 1,
                                            estimated: false, firstTokenMs: nil, totalMs: 10,
                                            replaced: false)

private func errorEvent(_ message: String) -> TranslateEvent {
    .error(message: message, actions: [], needsPermission: false, permission: nil, source: nil)
}

/// 让 session 里起的 Task 跑完（防抖传 0、假 backend 的方法都立即返回）。
private func settle() async {
    for _ in 0 ..< 20 { await Task.yield() }
    try? await Task.sleep(for: .milliseconds(20))
}

/// 等到条件成立（最多约 2 秒）。并行跑测试时主线程忙，固定让出几次不一定够。
@MainActor
private func until(_ condition: () -> Bool) async {
    for _ in 0 ..< 200 where !condition() {
        try? await Task.sleep(for: .milliseconds(10))
    }
}

@MainActor
private func session(debounce: Duration = .zero) -> (ComposeSession, FakeBackend) {
    let backend = FakeBackend()
    let session = ComposeSession(backend: backend, debounce: debounce)
    return (session, backend)
}

/// 一次完整的主译文：start → delta → done。
@MainActor
private func translate(_ session: ComposeSession, id: UInt64, source: String = "你好", translation: String = "Hello") {
    session.apply(route: route(id), event: start(source))
    session.apply(route: route(id), event: .delta(text: translation))
    session.apply(route: route(id), event: doneEvent)
}

@Suite("撰写窗的纯规则")
struct ComposeRulesTests {
    @Test func 前台是umuo自己时没有粘贴目标() {
        // 从历史窗「再次编辑」唤出：前台是 umuo 自己，⌘⇧↩ 不该往那里粘贴。
        #expect(ComposeRules.owner("42", own: "42") == nil)
        #expect(ComposeRules.owner(nil, own: "42") == nil)
        #expect(ComposeRules.owner("7", own: "42") == "7")
    }

    @Test func 粘贴目标每次按来源重新算() {
        let target = ComposeRules.ownerForCaller
        // 浮窗点「在撰写窗打开」：用浮窗归属的应用
        #expect(target("42", "7", "42") == "7")
        // 撰写窗一直开着、当初由 A(9) 唤出，用户在 B(7) 划词后从浮窗打开：目标应为 B
        #expect(target("9", "7", "42") == "7")
        // 浮窗归属是 umuo 自己（截图翻译）：退回当前前台的外部应用，没有就没有目标
        #expect(target("9", "42", "42") == "9")
        #expect(target("42", "42", "42") == nil)
        // 历史窗「再次编辑」不带浮窗归属：前台是 umuo 自己时没有目标
        #expect(target("42", nil, "42") == nil)
    }

    @Test func 主译文请求只带用户选过的覆盖且交trim过的文本() throws {
        let plain = try #require(ComposeRules.request("  你好  ", .init()))
        #expect(plain.text == "你好")
        #expect(plain.mode == .compose)
        #expect(plain.sourceOverride == nil && plain.targetOverride == nil)

        let chosen = try #require(ComposeRules.request("你好", .init(sourceLang: "zh-CN", targetLang: "ja")))
        #expect(chosen.sourceOverride == "zh-CN")
        #expect(chosen.targetOverride == "ja")
        #expect(chosen.focusSource == nil)
    }

    @Test func 只有空白时不发请求() {
        #expect(ComposeRules.request(" \n\t ", .init()) == nil)
    }

    @Test func 快捷键Esc收起_命令回车提交_带Shift还要粘贴() {
        #expect(ComposeKey.of(keyCode: 53, command: false, shift: false, composing: false) == .escape)
        #expect(ComposeKey.of(keyCode: 36, command: true, shift: false, composing: false) == .commit(paste: false))
        #expect(ComposeKey.of(keyCode: 36, command: true, shift: true, composing: false) == .commit(paste: true))
        #expect(ComposeKey.of(keyCode: 76, command: true, shift: false, composing: false) == .commit(paste: false))
        // 不带 ⌘ 的回车是换行，交给输入框
        #expect(ComposeKey.of(keyCode: 36, command: false, shift: false, composing: false) == nil)
        #expect(ComposeKey.of(keyCode: 0, command: true, shift: false, composing: false) == nil)
    }

    @Test func 输入法组字时Esc与回车属于输入法() {
        #expect(ComposeKey.of(keyCode: 53, command: false, shift: false, composing: true) == nil)
        #expect(ComposeKey.of(keyCode: 36, command: true, shift: false, composing: true) == nil)
    }
}

@Suite("撰写窗视图模型")
@MainActor
struct ComposeSessionTests {
    @Test func 停下输入后带着当前选择发一次() async {
        let (session, backend) = session()
        session.overrides.targetLang = "ja"
        session.input = "你好"
        await settle()
        #expect(backend.translated.map(\.text) == ["你好"])
        #expect(backend.translated.first?.targetOverride == "ja")
    }

    @Test func 连续输入只在停下之后发最后那一版() async throws {
        let (session, backend) = session(debounce: .milliseconds(50))
        session.input = "你"
        session.input = "你好"
        session.input = "你好呀"
        await until { !backend.translated.isEmpty }
        // 再多等几个防抖周期：被顶掉的计时不该迟到地再发一次
        try await Task.sleep(for: .milliseconds(200))
        #expect(backend.translated.map(\.text) == ["你好呀"])
    }

    @Test func 翻译中的新输入只排队_这次结束后才发() async {
        let (session, backend) = session()
        session.input = "第一版"
        await settle()
        session.apply(route: route(1), event: start("第一版"))
        session.input = "第二版"
        await settle()
        #expect(backend.translated.map(\.text) == ["第一版"])
        session.apply(route: route(1), event: doneEvent)
        #expect(backend.translated.map(\.text) == ["第一版", "第二版"])
    }

    @Test func 主译文出错同样推动排队的那一次() async {
        let (session, backend) = session()
        session.input = "第一版"
        await settle()
        session.input = "第二版"
        await settle()
        session.apply(route: route(1), event: errorEvent("网络错误"))
        #expect(backend.translated.map(\.text) == ["第一版", "第二版"])
    }

    @Test func 关掉自动翻译时输入不发_再打开就按当前输入发() async {
        let (session, backend) = session()
        session.autoTranslate = false
        session.input = "你好"
        await settle()
        #expect(backend.translated.isEmpty)
        session.autoTranslate = true
        await settle()
        #expect(backend.translated.map(\.text) == ["你好"])
    }

    @Test func 从浮窗带过来的原文只填输入框_自动翻译关着就不翻() async {
        let (session, backend) = session()
        session.autoTranslate = false
        session.prefill("Hello world")
        await settle()
        #expect(session.input == "Hello world")
        #expect(backend.translated.isEmpty)
    }

    @Test func 换一个下拉就按新选择再翻一次() async {
        let (session, backend) = session()
        session.input = "你好"
        await settle()
        translate(session, id: 1)
        session.overrides.targetLang = "ja"
        await settle()
        #expect(backend.translated.count == 2)
        #expect(backend.translated.last?.targetOverride == "ja")
    }

    @Test func 没能发出去时显示原因并且不卡在翻译中() async {
        let (session, backend) = session()
        backend.translateFailure = "内核启动中…"
        session.input = "第一版"
        await settle()
        #expect(session.state.status == .error)
        #expect(session.state.error == "内核启动中…")
        #expect(!session.queue.streaming)
        backend.translateFailure = nil
        session.input = "第二版"
        await settle()
        #expect(backend.translated.map(\.text) == ["第一版", "第二版"])
    }

    @Test func 流式中途不能提交() async {
        let (session, backend) = session()
        session.apply(route: route(1), event: start("你好"))
        session.apply(route: route(1), event: .delta(text: "Hel"))
        #expect(!session.settled)
        session.commit(paste: false)
        await settle()
        #expect(backend.translated.isEmpty)
        #expect(backend.commits.isEmpty)
    }

    @Test func 提交带上唤出时记下的目标并说明结果() async {
        let (session, backend) = session()
        session.owner = "7"
        translate(session, id: 1)
        session.commit(paste: true)
        await settle()
        #expect(backend.commits.count == 1)
        #expect(backend.commits.first?.text == "Hello")
        #expect(backend.commits.first?.paste == true)
        #expect(backend.commits.first?.owner == "7")
        #expect(session.notice == "已复制并粘贴")
        session.commit(paste: false)
        await settle()
        #expect(session.notice == "已复制译文")
    }

    @Test func 提交失败时说出原因() async {
        let (session, backend) = session()
        backend.commitFailure = "译文已复制到剪贴板，但原来的应用没能回到前台，没有自动粘贴。可以手动 ⌘V。"
        translate(session, id: 1)
        session.commit(paste: true)
        await settle()
        #expect(session.notice == "提交失败：译文已复制到剪贴板，但原来的应用没能回到前台，没有自动粘贴。可以手动 ⌘V。")
    }

    @Test func 重试走调度器() async {
        let (session, backend) = session()
        session.input = "你好"
        await settle()
        session.apply(route: route(1), event: start("你好"))
        session.apply(route: route(1), event: errorEvent("网络错误"))
        session.retry()
        #expect(backend.translated.map(\.text) == ["你好", "你好"])
        // 重试的这次还没结束：再来一次输入只排队
        session.input = "你好呀"
        await settle()
        #expect(backend.translated.count == 2)
    }

    @Test func Esc只收起() {
        let (session, backend) = session()
        session.escape()
        #expect(backend.hidden == 1)
    }

    @Test func 词卡朗读交给backend() {
        let (session, backend) = session()
        session.speak("hello")
        #expect(backend.spoken == ["hello"])
    }
}
