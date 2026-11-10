import Testing
@testable import Umuo

// 翻译浮窗与语音浮层共用一个全局 Esc：注册一次，按最近认领的一方路由。假的注册者不碰真实按键。

@MainActor
private final class FakeEscapeKey: EscapeKey {
    private(set) var registrations = 0
    private(set) var action: (@MainActor () -> Void)?
    var fails = false

    var isRegistered: Bool { action != nil }

    func register(_ action: @escaping @MainActor () -> Void) throws {
        if fails { throw GlobalHotkeys.Failure.status(-9878) }
        registrations += 1
        self.action = action
    }

    func unregister() { action = nil }

    func press() { action?() }
}

@MainActor
struct EscapeRouterTests {
    @Test func 没有认领者时不注册_有就注册一次() {
        let key = FakeEscapeKey()
        let router = EscapeRouter(key: key)
        #expect(!router.isArmed)
        router.claim(.panel) {}
        router.claim(.voice) {}
        router.claim(.panel) {}
        #expect(key.registrations == 1, "同一个 Esc 只注册一次")
        router.release(.panel)
        #expect(router.isArmed)
        router.release(.voice)
        #expect(!router.isArmed, "都交还了就注销，不吞别的应用的 Esc")
    }

    @Test func 两边都开着时Esc给最近弹出的一方_交还后回到另一方() {
        let key = FakeEscapeKey()
        let router = EscapeRouter(key: key)
        var hits: [String] = []
        router.claim(.panel) { hits.append("panel") }
        router.claim(.voice) { hits.append("voice") }
        key.press()
        #expect(hits == ["voice"])
        // 浮窗在流式翻译中反复同步 Esc：不能把后弹出的语音压下去
        router.claim(.panel) { hits.append("panel2") }
        key.press()
        #expect(hits == ["voice", "voice"])
        router.release(.voice)
        key.press()
        #expect(hits == ["voice", "voice", "panel2"])
    }

    @Test func 自己的其它窗口是key时浮窗交出Esc_恢复后重新注册() {
        let key = FakeEscapeKey()
        let router = EscapeRouter(key: key)
        var hits: [String] = []
        router.claim(.panel) { hits.append("panel") }
        router.yieldsToOwnWindow = true
        #expect(!router.isArmed, "设置 / 撰写窗是 key 时 Esc 要送到那个窗口")
        // 流式翻译中浮窗反复同步 Esc，也不能把它抢回来
        router.claim(.panel) { hits.append("panel") }
        #expect(!router.isArmed)
        router.yieldsToOwnWindow = false
        key.press()
        #expect(hits == ["panel"])
    }

    @Test func 交出Esc只对浮窗生效_语音浮层仍拦Esc() {
        let key = FakeEscapeKey()
        let router = EscapeRouter(key: key)
        var hits: [String] = []
        router.claim(.panel) { hits.append("panel") }
        router.claim(.voice) { hits.append("voice") }
        router.yieldsToOwnWindow = true
        key.press()
        #expect(hits == ["voice"], "录音中按 Esc 仍然取消录音")
        router.release(.voice)
        #expect(!router.isArmed, "语音收起后回到浮窗，浮窗此时应交出 Esc")
    }

    @Test func 先开语音后开浮窗时Esc给浮窗() {
        var claims = EscapeRouter.Claims()
        claims.claim(.voice)
        claims.claim(.panel)
        #expect(claims.top == .panel)
        claims.release(.panel)
        #expect(claims.top == .voice)
        claims.release(.voice)
        #expect(claims.top == nil)
    }

    @Test func 注册失败不崩_交还后可以重试() {
        let key = FakeEscapeKey()
        key.fails = true
        let router = EscapeRouter(key: key)
        router.claim(.voice) {}
        #expect(!router.isArmed)
        router.release(.voice)
        key.fails = false
        router.claim(.voice) {}
        #expect(router.isArmed)
    }
}
