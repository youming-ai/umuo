import AppKit
import Foundation
import Testing
import UmuoCore
@testable import Umuo

// 菜单栏：快捷面板的视图模型（暂停 / 恢复、当前模型、快速输入、复制最近一条）、菜单栏图标的样式与左右键分流、
// 菜单项与 Tauri 托盘逐条一致、首次引导要不要自动弹。假 backend 只记调用：不碰剪贴板、不发请求。

private struct Broken: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

@MainActor
private final class FakeQuick: QuickBackend {
    var paused = false
    var current: QuickState?
    var fail: String?
    var translated: [String] = []
    var translateError: Error?
    var copied: [String] = []
    var copyFailure: String?
    var opened: [String] = []

    func state() async throws -> QuickState {
        if let fail { throw Broken(message: fail) }
        return current ?? QuickState(paused: paused, providerLabel: "OpenAI", model: "gpt-4o-mini", recent: [
            QuickRecord(id: 3, source: "Hello", translation: "你好", model: "gpt-4o-mini"),
        ])
    }

    func setPaused(_ paused: Bool) -> Bool {
        self.paused = paused
        return paused
    }

    func translate(_ text: String) throws {
        if let translateError { throw translateError }
        translated.append(text)
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

    @Test func 快速输入只有空白时不发() {
        let backend = FakeQuick()
        let quick = model(backend)
        quick.draft = "  \n"
        #expect(!quick.canTranslate)
        quick.translate()
        #expect(backend.translated.isEmpty)
        quick.draft = "good morning"
        quick.translate()
        #expect(backend.translated == ["good morning"])
    }

    @Test func 翻译失败说在面板上() {
        let backend = FakeQuick()
        backend.translateError = Broken(message: ComposeRules.emptyText)
        let quick = model(backend)
        quick.draft = "x"
        quick.translate()
        #expect(quick.notice == "没有可翻译的内容")
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
    @Test func 样式规范化认不出的回落模板() {
        #expect(TrayIcon.style("brand") == "brand")
        #expect(TrayIcon.style(" black ") == "black")
        #expect(TrayIcon.style("不认识") == "template")
        #expect(TrayIcon.style(nil) == "template")
        #expect(TrayIcon.style(settingsJson: #"{"trayIconStyle":"brand"}"#) == "brand")
        #expect(TrayIcon.style(settingsJson: nil) == "template")
    }

    @Test func 只有模板样式交给系统着色() {
        #expect(TrayIcon.isTemplate("template"))
        #expect(!TrayIcon.isTemplate("brand"))
        #expect(!TrayIcon.isTemplate("black"))
        #expect(TrayIcon.resource("brand") == "tray-brand")
        #expect(TrayIcon.resource("black") == "tray-black")
        #expect(TrayIcon.resource("template") == "tray")
    }

    @Test func 三份图标都打进了资源包() {
        for style in ["template", "brand", "black"] {
            let url = TrayIcon.url(style)
            #expect(url != nil, "\(style)")
            #expect(url.flatMap(NSImage.init(contentsOf:)) != nil, "\(style)")
        }
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

    @Test func 菜单项与Tauri托盘逐条一致() {
        let titles = StatusBarController.entries.map { $0?.title ?? "—" }
        #expect(titles == ["翻译选中文本", "输入框原地替换", "撰写窗", "多模型对比", "截图翻译", "静默 OCR（只复制原文）", "—",
                           "快捷面板…", "翻译历史", "设置…", "检查更新…", "退出 umuo"])
        let actions = StatusBarController.entries.compactMap { entry -> HotkeyAction? in
            if case let .action(action)? = entry?.entry { return action }
            return nil
        }
        #expect(actions == [.selection, .silentReplace, .compose, .compare, .ocr, .ocrSilent])
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
