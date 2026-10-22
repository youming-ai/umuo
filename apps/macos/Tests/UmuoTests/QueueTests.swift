import Testing
@testable import Umuo

// compose-queue.test.ts 与 settings-queue.test.ts 逐条改写。

/// 守的是一个在真实界面里极难复现的失败形态：用户连续打字时，两次翻译的流式增量交错写进同一个译文区。
@Suite("撰写窗的翻译调度")
struct ComposeQueueTests {
    @Test func 空闲时输入会立刻发出去() {
        let decision = ComposeQueue.empty.onInput("你好")
        #expect(decision.start == "你好")
        #expect(decision.queue.streaming)
        #expect(decision.queue.pending == nil)
    }

    @Test func 翻译中再次输入只排队不发第二个请求() {
        let first = ComposeQueue.empty.onInput("第一版")
        #expect(first.start == "第一版")
        let second = first.queue.onInput("第二版")
        #expect(second.start == nil)
        #expect(second.queue.pending == "第二版")
        #expect(second.queue.streaming)
    }

    @Test func 排队时后来的输入覆盖先前的待办() {
        let third = ComposeQueue.empty.onInput("第一版").queue.onInput("第二版").queue.onInput("第三版")
        #expect(third.queue.pending == "第三版")
        #expect(third.start == nil)
    }

    @Test func 上一次结束后立刻发出排队的那一次然后回到空闲() {
        let queued = ComposeQueue.empty.onInput("第一版").queue.onInput("第二版")
        let afterFirst = queued.queue.onSettled()
        #expect(afterFirst.start == "第二版")
        #expect(afterFirst.queue.streaming)
        let afterSecond = afterFirst.queue.onSettled()
        #expect(afterSecond.start == nil)
        #expect(afterSecond.queue == .empty)
    }

    @Test func 没有待办时结束就回到空闲() {
        let settled = ComposeQueue.empty.onInput("只有一次").queue.onSettled()
        #expect(settled.start == nil)
        #expect(settled.queue == .empty)
    }

    @Test func 清空输入会取消还排着的那一次() {
        let cleared = ComposeQueue.empty.onInput("第一版").queue.onInput("第二版").queue.onInput("   ")
        #expect(cleared.queue.pending == nil)
        let settled = cleared.queue.onSettled()
        #expect(settled.start == nil)
        #expect(settled.queue == .empty)
    }

    @Test func 输入前后空白不改变发出的内容() {
        #expect(ComposeQueue.empty.onInput("  你好  ").start == "你好")
    }
}

private typealias S = [String: JSONValue]

private let base: S = ["theme": .string("system"), "proxy": .string(""), "scale": .number(1), "remembered": .string("")]

private struct InvalidProxy: Error, Equatable {}

/// 假的后端：保存时把改动叠在「此刻的值」上，模拟 applySettingsPatch 的现读现写。
@MainActor
private final class Backend {
    var stored: S
    let validate: (S) throws -> Void

    init(_ initial: S, validate: @escaping (S) throws -> Void = { _ in }) {
        stored = initial
        self.validate = validate
    }

    func write(_ patch: S) { stored.merge(patch) { _, new in new } }

    func save(_ patch: S) async throws -> S {
        // 让出一次：保存真的「在路上」，后面的提交与刷新会在它落定之前到达
        await Task.yield()
        let next = stored.merging(patch) { _, new in new }
        try validate(next)
        stored = next
        return stored
    }
}

private func rejectBadProxy(_ s: S) throws {
    if s["proxy"] == .string("bad") { throw InvalidProxy() }
}

@Suite("设置的改了就存队列")
@MainActor
struct SettingsQueueTests {
    @Test func 逐个保存后一次叠在前一次之上() async throws {
        let server = Backend(base)
        let queue = SettingsQueue(initial: base, save: server.save)
        let a = queue.commit(["theme": .string("dark")])
        let b = queue.commit(["scale": .number(1.25)])
        try await a.value
        try await b.value
        #expect(server.stored == base.merging(["theme": .string("dark"), "scale": .number(1.25)]) { _, new in new })
    }

    @Test func 一个字段存失败只退回它自己不拖累后面的改动() async throws {
        let server = Backend(base, validate: rejectBadProxy)
        var shown: [S] = []
        let queue = SettingsQueue(initial: base, save: server.save)
        queue.onChange = { shown.append($0) }
        let failed = queue.commit(["proxy": .string("bad")])
        let ok = queue.commit(["theme": .string("dark")])
        await #expect(throws: InvalidProxy.self) { try await failed.value }
        try await ok.value
        #expect(queue.current == base.merging(["theme": .string("dark")]) { _, new in new })
        #expect(server.stored["proxy"] == .string(""))
        // 界面确实被通知过回滚（而不只是内部状态对了）
        #expect(shown.contains { $0["proxy"] == .string("bad") })
        #expect(shown.last?["proxy"] == .string(""))
    }

    @Test func 失败的旧提交不会冲掉同一字段后来的新值() async throws {
        let server = Backend(base, validate: rejectBadProxy)
        var shown: [S] = []
        let queue = SettingsQueue(initial: base, save: server.save)
        queue.onChange = { shown.append($0) }
        let failed = queue.commit(["proxy": .string("bad")])
        let newer = queue.commit(["proxy": .string("socks5://ok")])
        await #expect(throws: InvalidProxy.self) { try await failed.value }
        // 失败那一刻界面上应仍是新值，不能闪回旧值
        #expect(shown.enumerated().allSatisfy { $0.offset < 2 || $0.element["proxy"] == .string("socks5://ok") })
        try await newer.value
        #expect(queue.current["proxy"] == .string("socks5://ok"))
    }

    @Test func 不会用窗口里的旧快照抹掉别处刚写进来的值() async throws {
        // 设置窗开着时，浮窗记住了 Slack 的目标语言；随后在设置窗里拨一个开关。
        let server = Backend(base)
        let queue = SettingsQueue(initial: base, save: server.save)
        server.write(["remembered": .string("Slack→en")])
        try await queue.commit(["theme": .string("dark")]).value
        #expect(server.stored["remembered"] == .string("Slack→en"))
        #expect(queue.current["remembered"] == .string("Slack→en"))
    }

    @Test func 空闲时刷新跟上后端有保存在路上时不刷新() async throws {
        let server = Backend(base)
        let queue = SettingsQueue(initial: base, save: server.save)
        queue.refresh(base.merging(["remembered": .string("Slack→en")]) { _, new in new })
        #expect(queue.current["remembered"] == .string("Slack→en"))

        let inFlight = queue.commit(["theme": .string("dark")])
        queue.refresh(base)
        #expect(queue.current["theme"] == .string("dark"))
        try await inFlight.value
    }

    @Test func 落定后以后端规范化过的值为准() async throws {
        let queue = SettingsQueue<JSONValue>(initial: base) { patch in
            var next = base.merging(patch) { _, new in new }
            next["scale"] = .number((patch["scale"]?.numberValue ?? 1).rounded())
            return next
        }
        try await queue.commit(["scale": .number(2.4)]).value
        #expect(queue.current["scale"] == .number(2))
    }
}
