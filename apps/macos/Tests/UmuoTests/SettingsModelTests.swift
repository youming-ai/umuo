import Foundation
import SwiftUI
import Testing
import UmuoCore
@testable import Umuo

// 设置窗的视图模型：只交改了的键、失败只退回那一行、换供应商的连带规则、录键暂停全局快捷键、
// 假 backend 只记调用：不碰真实 Keychain、剪贴板、TCC 与 LaunchAgents。

private struct Rejected: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

@MainActor
private final class FakeBackend: SettingsBackend {
    var stored: SettingsValues
    var patches: [SettingsValues] = []
    /// 这些键一出现在 patch 里就保存失败（模拟 Rust 的校验）。
    var rejectKeys: Set<String> = []
    var keys: [String: String] = [:]
    var keyChecks: [String] = []
    var recording: [Bool] = []
    var perms = PermissionStatus(accessibility: true, screenRecording: true)
    var calls: [String] = []
    var autostartResult: Result<Bool, Error> = .success(true)
    var failures: [String] = []

    init(_ stored: SettingsValues) { self.stored = stored }

    func loadSettings() async throws -> SettingsValues { stored }

    func applyPatch(_ patch: SettingsValues) async throws -> SettingsValues {
        await Task.yield()
        patches.append(patch)
        if let bad = patch.keys.first(where: rejectKeys.contains) { throw Rejected(message: "\(bad) 不合法") }
        stored.merge(patch) { _, new in new }
        return stored
    }

    func providers() async -> [ProviderDetail] {
        [
            ProviderDetail(id: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini", suggestedModels: ["gpt-4o"],
                           keysUrl: "https://x", requiresKey: true, requiresBaseUrl: false, local: false),
            ProviderDetail(id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat", suggestedModels: [],
                           keysUrl: "", requiresKey: true, requiresBaseUrl: false, local: false),
            ProviderDetail(id: "ollama", label: "Ollama", defaultModel: "qwen", suggestedModels: [],
                           keysUrl: "", requiresKey: false, requiresBaseUrl: false, local: true),
        ]
    }

    func keyStatus(_ providerId: String) async throws -> Bool {
        keyChecks.append(providerId)
        return keys[providerId] != nil
    }

    func saveApiKey(_ providerId: String, _ key: String) async throws { keys[providerId] = key }
    func deleteApiKey(_ providerId: String) async throws { keys[providerId] = nil }
    /// 每次拉模型时后端存着的设置：看拉的是不是刚提交的端点。
    var listedWith: [SettingsValues] = []

    func listModels(_ providerId: String) async throws -> [String] {
        listedWith.append(stored)
        return ["\(providerId)-a", "\(providerId)-b"]
    }
    func permissions() async -> PermissionStatus { perms }
    func requestScreenRecording() async { calls.append("requestScreen") }
    func openSystemSettings(_ permission: PermissionKind) { calls.append("open:\(permission.rawValue)") }
    func openURL(_ url: String) { calls.append("url:\(url)") }
    func autostartStatus() async -> Bool? { false }
    func setAutostart(_: Bool) async throws -> Bool { try autostartResult.get() }
    func hotkeyFailures() -> [String] { failures }
    func setHotkeyRecording(_ active: Bool) { recording.append(active) }
    func exportConfig() async throws -> String { "/tmp/umuo-config.json" }

    func importConfig(_: String) async throws -> ImportResult {
        stored["theme"] = .string("dark")
        return ImportResult(providerId: "openai", targetLang: "en", customStyleCount: 0, glossaryCount: 0, bundleVersion: 1,
                            endpointChanges: [], blacklistAdded: [], blacklistRemoved: [],
                            settingsJson: JSONValue.json(stored), hotkeysChanged: false)
    }

    func openHistory() { calls.append("history") }
    func openOnboarding() { calls.append("onboarding") }
    var appVersion: String? { nil }
}

private let base: SettingsValues = [
    "providerId": .string("openai"), "model": .string("gpt-4o-mini"), "theme": .string("system"),
    "locale": .string("zh-CN"), "selectionHotkey": .string("Alt+D"), "composeHotkey": .string("Alt+Cmd+A"),
    "silentReplaceHotkey": .string("Alt+Shift+T"), "ocrHotkey": .string("Alt+Cmd+O"),
    "ocrSilentHotkey": .string("Alt+Shift+O"), "compareHotkey": .string("Alt+P"), "speakHotkey": .string("Alt+R"),
    "proxyMode": .string("system"), "proxyUrl": .string(""),
    "sceneModels": .object(["compare": .array([]), "futureScene": .string("keep")]),
    "customStyles": .array([]), "monthlyLimits": .array([]),
    "futureTopLevel": .string("keep"),
]

/// 等一个「保存在路上」的结果落定：轮流让出主线程，最多约 2 秒（不靠固定的 sleep，机器忙时也不误判）。
@MainActor
/// 上限放宽到 10 秒：CI 的 macOS runner 慢，全量并行时主线程排队，2 秒曾不够（条件满足即返回，不拖慢通过的用例）。
private func eventually(_ condition: () -> Bool) async {
    let deadline = ContinuousClock.now + .seconds(10)
    while !condition(), ContinuousClock.now < deadline {
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(1))
    }
}

@MainActor
private func loaded(_ backend: FakeBackend) async -> SettingsModel {
    let model = SettingsModel(backend: backend)
    await model.load()
    return model
}

@Suite("设置窗：载入与保存")
@MainActor
struct SettingsModelTests {
    @Test func 没配Key的新用户落在引擎页且点灯() async {
        let model = await loaded(FakeBackend(base))
        #expect(model.isLoaded)
        #expect(model.tab == .engine)
        #expect(model.keyConfigured == false)
        #expect(model.attention == [.engine])
    }

    @Test func 关掉再打开清掉各页草稿并整份重读() async {
        let backend = FakeBackend(base)
        backend.keys["openai"] = "sk"
        let model = await loaded(backend)
        #expect(model.tab == .general)
        model.tab = .advanced
        model.engine.apiKey = "sk-typed-not-saved"
        model.engine.modelNotice = "x"
        model.hotkeys.errors["ocrHotkey"] = "x"
        model.general.configPath = "/tmp/x"
        model.windowClosed()
        #expect(model.engine.apiKey.isEmpty)

        // 退役的月度上限还在配置里：原样保留，但不再让「高级」分区点灯。
        backend.stored["monthlyLimits"] = .array([.object(["providerId": .string("openai"), "limitUsd": .number(0)])])
        await model.reopen()
        #expect(!model.attention.contains(.advanced))
        #expect(model.tab == .general)
        #expect(model.engine.modelNotice == nil)
        #expect(model.hotkeys.errors.isEmpty)
        #expect(model.general.configPath.isEmpty)
        #expect(model.values.array("monthlyLimits").count == 1)
    }

    @Test func 配了Key缺权限落在权限页() async {
        let backend = FakeBackend(base)
        backend.keys["openai"] = "sk"
        backend.perms = PermissionStatus(accessibility: false, screenRecording: nil)
        let model = await loaded(backend)
        #expect(model.tab == .permissions)
        #expect(model.attention == [.permissions])
    }

    @Test func 本机模型不需要Key不点灯() async {
        var settings = base
        settings["providerId"] = .string("ollama")
        let model = await loaded(FakeBackend(settings))
        #expect(model.keyConfigured == true)
        #expect(model.tab == .general)
    }

    @Test func 只交改了的键() async throws {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        try await model.commit(["theme": .string("dark")]).value
        #expect(backend.patches == [["theme": .string("dark")]])
        #expect(model.values["theme"] == .string("dark"))
        // 别的键（含本版本不认识的）没被整份写回，原样留在后端
        #expect(backend.stored["futureTopLevel"] == .string("keep"))
    }

    @Test func 保存失败退回那个字段并显示在页面顶部() async {
        let backend = FakeBackend(base)
        backend.rejectKeys = ["proxyUrl"]
        let model = await loaded(backend)
        await #expect(throws: Rejected.self) { try await model.commit(["proxyUrl": .string("bad")]).value }
        #expect(model.values["proxyUrl"] == .string(""))
        #expect(model.saveError == "proxyUrl 不合法")
        // 下一次提交先清掉旧错误
        model.commit(["theme": .string("light")])
        #expect(model.saveError == nil)
    }

    @Test func 文本框一行的错误记在那一行() async {
        let backend = FakeBackend(base)
        backend.rejectKeys = ["model"]
        let model = await loaded(backend)
        _ = try? await model.commitRow("model", ["model": .string("")]).value
        #expect(model.rowErrors["model"] == "model 不合法")
    }

    @Test func 换供应商清掉Key草稿换成默认模型并重查Key状态() async throws {
        let backend = FakeBackend(base)
        backend.keys["deepseek"] = "sk-d"
        let model = await loaded(backend)
        model.engine.apiKey = "sk-typed-for-openai"
        model.engine.switchProvider("deepseek")
        #expect(model.engine.apiKey == "")
        // 等保存与随后的 Key 重查落定
        await eventually { backend.keyChecks.last == "deepseek" && model.keyConfigured == true }
        #expect(backend.patches.last == ["providerId": .string("deepseek"), "model": .string("deepseek-chat")])
        #expect(backend.keyChecks.last == "deepseek")
        #expect(model.keyConfigured == true)
    }

    @Test func 存Key去掉首尾空白清空草稿并点亮已配置() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.engine.apiKey = "  sk-new  "
        await model.engine.saveKey()
        #expect(backend.keys["openai"] == "sk-new")
        #expect(model.engine.apiKey == "")
        #expect(model.keyConfigured == true)
        await model.engine.clearKey()
        #expect(backend.keys["openai"] == nil)
        #expect(model.keyConfigured == false)
    }

    @Test func 拉到的模型列表在换了供应商之后不作数() async {
        let model = await loaded(FakeBackend(base))
        await model.engine.fetchModels()
        #expect(model.engine.models == ["openai-a", "openai-b"])
        #expect(model.engine.modelNotice == model.t("prefs.engine.gotModels", ["count": "2"]))
    }

    @Test func 拉模型等刚提交的端点存好再拉() async {
        // 端点框失焦即提交，与点「拉取模型」是同一下点击；内核按存好的地址拉，不等的话拉的是旧地址
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.commitRow("endpoint", ["customBaseUrl": .string("https://new.example/v1")])
        await model.engine.fetchModels()
        #expect(backend.listedWith.last?.string("customBaseUrl") == "https://new.example/v1")
    }

    @Test func 开机启动以实现返回的状态为准被拒时说出原因且不存设置() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        backend.autostartResult = .failure(EngineError.Failed(message: "临时位置"))
        await model.setAutostart(true)
        #expect(model.general.autostartError == "临时位置")
        #expect(backend.patches.isEmpty)
        backend.autostartResult = .success(true)
        await model.setAutostart(true)
        #expect(model.autostart == true)
        #expect(backend.patches.last == ["launchAtLogin": .bool(true)])
    }

    @Test func 导入配置后整页跟上新设置() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.general.configPath = " /tmp/a.json "
        await model.general.importConfig()
        #expect(model.values["theme"] == .string("dark"))
        #expect(model.general.configNotice?.isEmpty == false)
    }

    @Test func 导出的结果只显示在导出那一行并记下文件位置() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        await model.general.exportConfig()
        #expect(model.general.exportedPath == "/tmp/umuo-config.json")
        #expect(model.general.exportNotice?.contains("/tmp/umuo-config.json") == true)
        #expect(model.general.configNotice == nil)
    }

    @Test func 聚焦时跟上别处写进来的值() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        backend.stored["appTargetLangs"] = .object(["Slack": .string("en")])
        backend.perms = PermissionStatus(accessibility: false, screenRecording: true)
        await model.windowFocused()
        #expect(model.values.object("appTargetLangs")["Slack"] == .string("en"))
        #expect(model.permissions.accessibility == false)
    }

    @Test func 别处存了同一供应商的Key后聚焦就显示已配置() async {
        // 首次引导或另一个窗口存了 Key：供应商没变，但 Key 状态变了
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        #expect(model.keyConfigured == false)
        backend.keys["openai"] = "sk-from-onboarding"
        await model.windowFocused()
        #expect(model.keyConfigured == true)
        #expect(model.attention.isEmpty)
    }

    @Test func 别处换了供应商就清掉没保存的Key草稿() async {
        // 草稿是给上一个供应商填的：不清掉的话按「保存」会把它存到新供应商名下
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.engine.apiKey = "sk-typed-for-openai"
        backend.stored["providerId"] = .string("deepseek")
        await model.windowFocused()
        #expect(model.providerId == "deepseek")
        #expect(model.engine.apiKey == "")
        await model.engine.saveKey()
        #expect(backend.keys.isEmpty)

        // 导入配置换了首选也一样
        model.engine.apiKey = "sk-typed-for-deepseek"
        backend.stored["providerId"] = .string("openai")
        model.general.configPath = "/tmp/a.json"
        await model.general.importConfig()
        #expect(model.providerId == "openai")
        #expect(model.engine.apiKey == "")
    }
}

@Suite("设置窗：快捷键与录键")
@MainActor
struct HotkeyEditorTests {
    @Test func 录键期间暂停全局快捷键录到组合就保存并恢复() async throws {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.hotkeys.toggle("selectionHotkey")
        #expect(model.hotkeys.recording == "selectionHotkey")
        #expect(backend.recording == [true])
        // 只按修饰键：还在等
        #expect(model.hotkeys.modifiersChanged(keyCode: 0x3A, flags: 0x20, atMs: 1000))
        #expect(model.hotkeys.recording != nil)
        #expect(model.hotkeys.keyDown(HotkeyFormat.Key(code: "KeyE", alt: true), atMs: 1100))
        #expect(model.hotkeys.recording == nil)
        #expect(backend.recording == [true, false])
        await eventually { !backend.patches.isEmpty }
        #expect(backend.patches.last == ["selectionHotkey": .string("Alt+E")])
    }

    @Test func 换分区就结束录键并恢复全局快捷键() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        #expect(model.tab == .engine)
        model.hotkeys.toggle("selectionHotkey")
        // 同一个分区再点一下不算换页，照常在录
        model.tab = .engine
        #expect(model.hotkeys.recording == "selectionHotkey")
        model.tab = .general
        #expect(model.hotkeys.recording == nil)
        #expect(backend.recording == [true, false])
        // 换页之后按的键不再被录进去
        #expect(model.hotkeys.keyDown(HotkeyFormat.Key(code: "KeyV", cmd: true), atMs: 10) == false)
        #expect(backend.patches.isEmpty)
    }

    @Test func Esc只结束录制不保存() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.hotkeys.toggle("ocrHotkey")
        model.hotkeys.keyDown(HotkeyFormat.Key(code: "Escape"), atMs: 1)
        #expect(model.hotkeys.recording == nil)
        #expect(backend.recording == [true, false])
        #expect(backend.patches.isEmpty)
    }

    @Test func 录不了的键给提示继续录() async {
        let model = await loaded(FakeBackend(base))
        model.hotkeys.toggle("ocrHotkey")
        model.hotkeys.keyDown(HotkeyFormat.Key(code: "NumpadEnter", alt: true), atMs: 1)
        #expect(model.hotkeys.recording == "ocrHotkey")
        #expect(model.hotkeys.notice == model.t("prefs.hotkey.unsupported"))
    }

    @Test func 连按两下修饰键录成连按() async throws {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.hotkeys.toggle("selectionHotkey")
        for (down, up) in [(UInt64(1000), UInt64(1050)), (1150, 1200)] {
            model.hotkeys.modifiersChanged(keyCode: 0x3B, flags: 0x1, atMs: down)
            model.hotkeys.modifiersChanged(keyCode: 0x3B, flags: 0, atMs: up)
        }
        #expect(model.hotkeys.recording == nil)
        await eventually { !backend.patches.isEmpty }
        #expect(backend.patches.last == ["selectionHotkey": .string("Ctrl Ctrl")])
    }

    @Test func 同一时刻只有一行在录() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.hotkeys.toggle("selectionHotkey")
        model.hotkeys.toggle("ocrHotkey")
        #expect(model.hotkeys.recording == "ocrHotkey")
        // 先恢复、再暂停：暂停截止时间按新的这一次重新算
        #expect(backend.recording == [true, false, true])
        model.hotkeys.toggle("ocrHotkey")
        #expect(model.hotkeys.recording == nil)
        #expect(backend.recording == [true, false, true, false])
    }

    @Test func 与别的功能撞键就不存并在那一行说明() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        #expect(model.hotkeys.commit("ocrHotkey", "Option+D") == nil)
        #expect(backend.patches.isEmpty)
        #expect(model.hotkeys.message("ocrHotkey") == model.t("prefs.hotkey.duplicate", ["name": model.t("prefs.translate.selection")]))
    }

    @Test func 不带修饰键的F键也查重复不让两个功能都用F5() async {
        // 「缺修饰键」只是提醒、照样能存；它若抢在重复检查之前返回，两个功能就能同时设成 F5，其中一个注册时静默失败。
        #expect(HotkeyConflict.check("F5", others: [(label: "划词翻译", value: "F5")])?.kind == .duplicate)
        var settings = base
        settings["selectionHotkey"] = .string("F5")
        let backend = FakeBackend(settings)
        let model = await loaded(backend)
        #expect(model.hotkeys.commit("ocrHotkey", "F5") == nil)
        #expect(model.hotkeys.errors["ocrHotkey"] == model.t("prefs.hotkey.duplicate", ["name": model.t("prefs.translate.selection")]))
        #expect(backend.patches.isEmpty)
    }

    @Test func 语音键与翻译入口互查冲突且只收组合键() async {
        var settings = base
        settings[HotkeyCenter.voiceField] = .string("Alt+Cmd+V")
        let backend = FakeBackend(settings)
        let model = await loaded(backend)
        // 语音键撞上翻译入口：不存
        #expect(model.hotkeys.commit(HotkeyCenter.voiceField, "Option+D") == nil)
        #expect(model.hotkeys.errors[HotkeyCenter.voiceField] != nil)
        // 两个语音键互撞也不存
        #expect(model.hotkeys.commit(HotkeyCenter.voiceTranslateField, "Alt+Cmd+V") == nil)
        // 按住说话不能用连按两下修饰键
        #expect(model.hotkeys.commit(HotkeyCenter.voiceField, "Ctrl Ctrl") == nil)
        #expect(model.hotkeys.errors[HotkeyCenter.voiceField] == model.t("prefs.hotkey.comboOnly"))
        #expect(backend.patches.isEmpty)
        // 合法的组合键照常保存
        let pending = model.hotkeys.commit(HotkeyCenter.voiceTranslateField, "Ctrl+Alt+T")
        #expect(pending != nil)
        try? await pending?.value
        #expect(backend.patches.last == [HotkeyCenter.voiceTranslateField: .string("Ctrl+Alt+T")])
    }

    @Test func 注册失败的行标出来连按与组合键文案不同() async {
        var settings = base
        settings["selectionHotkey"] = .string("Ctrl Ctrl")
        let backend = FakeBackend(settings)
        backend.failures = ["selectionHotkey", "ocrHotkey"]
        let model = await loaded(backend)
        #expect(model.hotkeys.message("selectionHotkey") == model.t("prefs.hotkey.tapFailed"))
        #expect(model.hotkeys.message("ocrHotkey") == model.t("prefs.hotkey.registerFailed"))
        #expect(model.hotkeys.message("composeHotkey") == nil)
    }
}

@Suite("设置窗：高级与路由")
@MainActor
struct SettingsEditorsTests {

    @Test func 代理选自定义先展开地址填好再一起保存() async throws {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.advanced.selectProxy("custom")
        #expect(model.advanced.proxyMode == "custom")
        #expect(backend.patches.isEmpty)
        try await model.advanced.commitProxyUrl("socks5://127.0.0.1:1080").value
        #expect(backend.patches.last == ["proxyMode": .string("custom"), "proxyUrl": .string("socks5://127.0.0.1:1080")])
        #expect(model.advanced.pendingCustom == false)
    }

    @Test func 保留天数取整负数归零() async throws {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        try await model.advanced.commitRetention("-3")?.value
        #expect(backend.patches.last == ["historyRetentionDays": .number(0)])
        #expect(model.advanced.commitRetention("abc") == nil)
    }

    @Test func 退役键位保留但不阻止活跃入口复用() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        // 旧对比默认是 Alt+P；OCR 可以复用它，不被退役字段误报冲突。
        let pending = model.hotkeys.commit("ocrHotkey", "Alt+P")
        #expect(pending != nil)
        try? await pending?.value
        #expect(backend.stored.string("ocrHotkey") == "Alt+P")
        #expect(backend.stored.string("compareHotkey") == "Alt+P")
        #expect(backend.stored.string("ocrSilentHotkey") == "Alt+Shift+O")
        #expect(backend.stored.string("speakHotkey") == "Alt+R")
        let count = backend.patches.count
        model.hotkeys.toggle("compareHotkey")
        #expect(model.hotkeys.recording == nil)
        #expect(model.hotkeys.commit("speakHotkey", "Alt+S") == nil)
        #expect(backend.patches.count == count)
    }

}

@Suite("设置窗：每一页都画得出来")
@MainActor
struct SettingsViewRenderTests {
    @Test(arguments: SettingsTab.allCases)
    func 每一页在浅色与深色下渲染不崩(tab: SettingsTab) async {
        var settings = base
        settings["targetLangMode"] = .string("perApp")
        settings["appTargetLangs"] = .object(["Slack": .string("en")])
        settings["monthlyLimits"] = .array([.object(["providerId": .string("openai"), "limitUsd": .number(1)])])
        let backend = FakeBackend(settings)
        let model = await loaded(backend)
        model.tab = tab
        for scheme in [ColorScheme.light, .dark] {
            let view = SettingsPane(model: model, tab: tab).frame(width: 680, height: 560).environment(\.colorScheme, scheme)
            #expect(ImageRenderer(content: view).nsImage != nil, "\(tab) / \(scheme)")
        }
    }
}

@Suite("设置工具栏语言同步", .serialized)
@MainActor
struct SettingsPaneLocalizationTests {
    @Test func 首次载入已保存语言后刷新工具栏() async {
        _ = NSApplication.shared
        let backend = FakeBackend(base)
        let model = SettingsModel(backend: backend)
        // 控制器先创建、设置后载入，与设置窗口首次打开的顺序一致。
        backend.stored["locale"] = .string(model.t.locale == .en ? "ja" : "en")
        let controller = SettingsPaneController(model: model, updater: nil)
        let window = NSWindow(contentViewController: controller)
        window.isReleasedWhenClosed = false
        await model.load()
        await eventually { controller.tabViewItems.first?.label == model.t(SettingsTab.general.titleKey) }
        checkLabels(controller, window: window, model: model)
    }

    @Test func 切换语言及保存失败回滚时保持当前分区() async throws {
        _ = NSApplication.shared
        let backend = FakeBackend(base)
        let model = SettingsModel(backend: backend)
        await model.load()
        let controller = SettingsPaneController(model: model, updater: nil)
        let window = NSWindow(contentViewController: controller)
        window.isReleasedWhenClosed = false
        model.tab = .engine
        for locale in AppLocale.allCases {
            try await model.commit(["locale": .string(locale.rawValue)]).value
            await eventually { controller.tabViewItems.first?.label == model.t(SettingsTab.general.titleKey) }
            checkLabels(controller, window: window, model: model)
            #expect(model.tab == .engine)
        }
        backend.rejectKeys = ["locale"]
        let failed = model.commit(["locale": .string("en")])
        _ = await failed.result
        await eventually { controller.tabViewItems.first?.label == model.t(SettingsTab.general.titleKey) }
        checkLabels(controller, window: window, model: model)
        #expect(model.values.string("locale") == AppLocale.ja.rawValue)
        #expect(model.tab == .engine)
    }

    private func checkLabels(_ controller: SettingsPaneController, window: NSWindow, model: SettingsModel) {
        for (tab, item) in zip(SettingsTab.allCases, controller.tabViewItems) {
            let label = model.t(tab.titleKey)
            #expect(item.label == label)
            #expect(item.viewController?.title == label)
            #expect(item.image?.accessibilityDescription == label)
        }
        if let tab = model.tab { #expect(window.title == model.t(tab.titleKey)) }
        #expect(window.toolbar?.items.map(\.label) == SettingsTab.allCases.map { model.t($0.titleKey) })
    }
}
