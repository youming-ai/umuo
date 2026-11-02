import AppKit
import Foundation
import Testing
import UmuoCore
@testable import Umuo

// 菜单栏：快捷面板的视图模型（暂停 / 恢复、当前模型、复制最近一条）、菜单栏图标与左右键分流、
// 菜单栏菜单的项、首次引导要不要自动弹。假 backend 只记调用：不碰剪贴板、不发请求。

private struct Broken: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

@MainActor
private final class FakeQuick: QuickBackend {
    var paused = false
    var current: QuickState?
    var fail: String?
    var copied: [String] = []
    var copyFailure: String?
    var opened: [String] = []
    /// 为 true 时读取挂起，直到测试用 `waiting` 交回一个结果：模拟读取途中用户切了开关。
    var hold = false
    var waiting: CheckedContinuation<QuickState, Never>?

    func state() async throws -> QuickState {
        if hold { return await withCheckedContinuation { waiting = $0 } }
        if let fail { throw Broken(message: fail) }
        return current ?? QuickState(paused: paused, providerLabel: "OpenAI", model: "gpt-4o-mini", recent: [
            QuickRecord(id: 3, source: "Hello", translation: "你好", model: "gpt-4o-mini"),
        ])
    }

    func setPaused(_ paused: Bool) -> Bool {
        self.paused = paused
        return paused
    }

    func copy(_ text: String) async -> String? {
        copied.append(text)
        return copyFailure
    }

    func openSettings() { opened.append("settings") }
    func openHistory() { opened.append("history") }
}

@MainActor
private func model(_ backend: FakeQuick) -> QuickModel {
    let model = QuickModel(backend: backend)
    model.t = Translate(locale: .zhCN)
    return model
}

@MainActor
@Suite("快捷面板")
struct QuickModelTests {
    @Test func 读取途中切了开关_晚到的旧结果不盖回去() async {
        let backend = FakeQuick()
        backend.hold = true
        let quick = model(backend)
        let reading = Task { await quick.refresh() }
        for _ in 0 ..< 200 where backend.waiting == nil {
            try? await Task.sleep(for: .milliseconds(5))
        }
        quick.togglePause()
        #expect(quick.paused)
        // 读取开始时还没暂停：晚到的结果里 paused 是 false
        backend.waiting?.resume(returning: QuickState(paused: false, providerLabel: "OpenAI", model: "m", recent: []))
        await reading.value
        #expect(quick.paused)
        #expect(backend.paused)
        // 下一次干净的读取以后端为准
        backend.hold = false
        await quick.refresh()
        #expect(quick.paused)
    }

    @Test func 第一次读取失败时切换开关也显示切换后的状态() async {
        let backend = FakeQuick()
        backend.fail = "内核启动中…"
        let quick = model(backend)
        await quick.refresh()
        #expect(quick.state == nil)
        quick.togglePause()
        #expect(quick.paused)
        quick.togglePause()
        #expect(!quick.paused)
    }

    @Test func 显示时读状态当前模型一行() async {
        let backend = FakeQuick()
        let quick = model(backend)
        #expect(quick.modelLine == "…")
        await quick.refresh()
        #expect(quick.modelLine == "OpenAI · gpt-4o-mini")
        backend.current = QuickState(paused: false, providerLabel: "Ollama", model: "", recent: [])
        await quick.refresh()
        #expect(quick.modelLine == "Ollama · 未选择")
    }

    @Test func 第一次读不到说原因之后的失败不打扰() async {
        let backend = FakeQuick()
        backend.fail = "内核启动中…"
        let quick = model(backend)
        await quick.refresh()
        #expect(quick.notice == "快捷面板不可用：内核启动中…")

        backend.fail = nil
        await quick.refresh()
        quick.notice = nil
        backend.fail = "又坏了"
        await quick.refresh()
        #expect(quick.notice == nil)
        #expect(quick.state != nil)
    }

    @Test func 暂停与恢复切的是全局快捷键() async {
        let backend = FakeQuick()
        let quick = model(backend)
        await quick.refresh()
        quick.togglePause()
        #expect(backend.paused)
        #expect(quick.paused)
        quick.togglePause()
        #expect(!backend.paused)
        #expect(!quick.paused)
    }

    @Test func 点最近一条复制译文() async {
        let backend = FakeQuick()
        let quick = model(backend)
        await quick.refresh()
        let record = try! #require(quick.state?.recent.first)
        await quick.copy(record)
        #expect(backend.copied == ["你好"])
        #expect(quick.notice == "已复制译文")
        backend.copyFailure = "剪贴板写不进去"
        await quick.copy(record)
        #expect(quick.notice == "剪贴板写不进去")
    }
}

@Suite("菜单栏图标")
struct StatusBarTests {
    @Test func 模板图标打进了资源包() {
        let url = TrayIcon.url
        #expect(url != nil)
        #expect(url.flatMap(NSImage.init(contentsOf:)) != nil)
    }

    @Test func 左键开快捷面板右键与Control左键出菜单() {
        #expect(StatusClick.route(type: .leftMouseUp, modifiers: []) == .quickPanel)
        #expect(StatusClick.route(type: .rightMouseUp, modifiers: []) == .menu)
        #expect(StatusClick.route(type: .leftMouseUp, modifiers: .control) == .menu)
        #expect(StatusClick.route(type: nil, modifiers: []) == .quickPanel)
    }

    @Test func 刚被这次点击收起的面板不再弹回来() {
        // transient 面板在点图标的 mouseDown 收起，按钮 action 在 mouseUp 才到
        #expect(!QuickPanelController.shouldReopen(closedAt: 100, now: 100.1))
        #expect(QuickPanelController.shouldReopen(closedAt: 100, now: 100.5))
        #expect(QuickPanelController.shouldReopen(closedAt: -.infinity, now: 0))
    }

    @Test func 菜单只提供保留的功能入口() {
        let titles = { (locale: AppLocale) in
            StatusBarController.entries.map { $0.map { Translate(locale: locale)($0.key) } ?? "—" }
        }
        #expect(titles(.zhCN) == ["翻译选中文本", "输入框原地替换", "撰写窗", "截图翻译", "—",
                                  "快捷面板", "翻译历史", "设置…", "检查更新…", "退出 umuo"])
        // 菜单跟随界面语言，不再写死中文
        #expect(titles(.en) == ["Translate Selection", "Replace in Text Field", "Compose", "Translate Screenshot", "—",
                                "Quick Panel", "History", "Settings…", "Check for Updates…", "Quit umuo"])
        let actions = StatusBarController.entries.compactMap { entry -> HotkeyAction? in
            if case let .action(action)? = entry?.entry { return action }
            return nil
        }
        #expect(actions == [.selection, .silentReplace, .compose, .ocr])
    }
}

@Suite("首次引导自动弹出")
struct OnboardingLaunchTests {
    @Test func 只看显式记下的走完没有() {
        #expect(AppModel.needsOnboarding(settingsJson: #"{"onboardingDone":false}"#))
        #expect(AppModel.needsOnboarding(settingsJson: #"{}"#))
        #expect(!AppModel.needsOnboarding(settingsJson: #"{"onboardingDone":true}"#))
        // 读不到设置时不弹：内核都没打开，引导里什么也存不下
        #expect(!AppModel.needsOnboarding(settingsJson: nil))
        #expect(!AppModel.needsOnboarding(settingsJson: "not json"))
    }
}
