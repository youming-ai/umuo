import Foundation
import SwiftUI
import Testing
import UmuoCore
@testable import Umuo

// 设置窗的视图模型：只交改了的键、失败只退回那一行、换供应商的连带规则、录键暂停全局快捷键、
// 预设与术语表的保存顺序。假 backend 只记调用：不碰真实 Keychain、剪贴板、TCC 与 LaunchAgents。

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
    var lists: [Glossary] = []
    var calls: [String] = []
    var autostartResult: Result<Bool, Error> = .success(true)
    var stylesReloaded = 0
    var copied: [String] = []
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

    func styles() async -> [StyleInfo] {
        stylesReloaded += 1
        return [StyleInfo(id: "standard", label: "标准", custom: false)]
    }

    func keyStatus(_ providerId: String) async throws -> Bool {
        keyChecks.append(providerId)
        return keys[providerId] != nil
    }

    func saveApiKey(_ providerId: String, _ key: String) async throws { keys[providerId] = key }
    func deleteApiKey(_ providerId: String) async throws { keys[providerId] = nil }
    func listModels(_ providerId: String) async throws -> [String] { ["\(providerId)-a", "\(providerId)-b"] }
    func permissions() async -> PermissionStatus { perms }
    func requestScreenRecording() async { calls.append("requestScreen") }
    func openSystemSettings(_ permission: PermissionKind) { calls.append("open:\(permission.rawValue)") }
    func openURL(_ url: String) { calls.append("url:\(url)") }
    func autostartStatus() async -> Bool? { false }
    func setAutostart(_: Bool) async throws -> Bool { try autostartResult.get() }
    func hotkeyFailures() -> [String] { failures }
    func setHotkeyRecording(_ active: Bool) { recording.append(active) }
    func comparePicks() async -> [ComparePick] { [] }
    func usageSummary() async -> UsageSummary? { nil }
    var spendList: [ProviderUsage] = []
    func monthlySpend() async -> [ProviderUsage] { spendList }
    func glossaries() async throws -> [Glossary] { lists }

    func saveGlossary(_ glossary: Glossary) async throws {
        calls.append("saveGlossary:\(glossary.id)")
        lists = lists.filter { $0.id != glossary.id } + [glossary]
    }

    func importGlossary(id: String, text: String) async throws -> UInt32 {
        calls.append("importGlossary:\(id)")
        return UInt32(text.split(separator: "\n").count)
    }

    func exportGlossary(id: String) async throws -> String { "source,target\n\(id),x" }

    func removeGlossary(id: String) async throws -> [Glossary] {
        lists.removeAll { $0.id == id }
        return lists
    }

    func copyText(_ text: String) async -> String? {
        copied.append(text)
        return nil
    }

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
private func eventually(_ condition: () -> Bool) async {
    let deadline = ContinuousClock.now + .seconds(2)
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
        model.hotkeys.errors["speakHotkey"] = "x"
        model.presets.startNew()
        model.general.configPath = "/tmp/x"
        model.windowClosed()
        #expect(model.engine.apiKey.isEmpty)

        backend.spendList = [ProviderUsage(providerId: "openai", count: 1, inputTokens: 1, outputTokens: 1,
                                           costUsd: 9, unpriced: 0)]
        backend.stored["monthlyLimits"] = .array([.object(["providerId": .string("openai"), "limitUsd": .number(5)])])
        await model.reopen()
        #expect(model.spend.count == 1)
        #expect(model.attention.contains(.advanced))
        #expect(model.tab == .general)
        #expect(model.engine.modelNotice == nil)
        #expect(model.hotkeys.errors.isEmpty)
        #expect(model.presets.editing == nil)
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

    @Test func 开机启动以实现返回的状态为准被拒时说出原因且不存设置() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        backend.autostartResult = .failure(Autostart.Failure(message: "临时位置"))
        await model.setAutostart(true)
        #expect(model.general.autostartError == "临时位置")
        #expect(backend.patches.isEmpty)
        backend.autostartResult = .success(true)
        await model.setAutostart(true)
        #expect(model.autostart == true)
        #expect(backend.patches.last == ["launchAtLogin": .bool(true)])
    }

    @Test func 导入配置后整页跟上新设置并刷新风格目录() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        let before = backend.stylesReloaded
        model.general.configPath = " /tmp/a.json "
        await model.general.importConfig()
        #expect(model.values["theme"] == .string("dark"))
        #expect(backend.stylesReloaded == before + 1)
        #expect(model.general.configNotice?.isEmpty == false)
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
        model.hotkeys.toggle("speakHotkey")
        model.hotkeys.keyDown(HotkeyFormat.Key(code: "Escape"), atMs: 1)
        #expect(model.hotkeys.recording == nil)
        #expect(backend.recording == [true, false])
        #expect(backend.patches.isEmpty)
    }

    @Test func 录不了的键给提示继续录() async {
        let model = await loaded(FakeBackend(base))
        model.hotkeys.toggle("speakHotkey")
        model.hotkeys.keyDown(HotkeyFormat.Key(code: "NumpadEnter", alt: true), atMs: 1)
        #expect(model.hotkeys.recording == "speakHotkey")
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
        model.hotkeys.toggle("speakHotkey")
        #expect(model.hotkeys.recording == "speakHotkey")
        // 先恢复、再暂停：暂停截止时间按新的这一次重新算
        #expect(backend.recording == [true, false, true])
        model.hotkeys.toggle("speakHotkey")
        #expect(model.hotkeys.recording == nil)
        #expect(backend.recording == [true, false, true, false])
    }

    @Test func 与别的功能撞键就不存并在那一行说明() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        #expect(model.hotkeys.commit("speakHotkey", "Option+D") == nil)
        #expect(backend.patches.isEmpty)
        #expect(model.hotkeys.message("speakHotkey") == model.t("prefs.hotkey.duplicate", ["name": model.t("prefs.translate.selection")]))
    }

    @Test func 注册失败的行标出来连按与组合键文案不同() async {
        var settings = base
        settings["selectionHotkey"] = .string("Ctrl Ctrl")
        let backend = FakeBackend(settings)
        backend.failures = ["selectionHotkey", "speakHotkey"]
        let model = await loaded(backend)
        #expect(model.hotkeys.message("selectionHotkey") == model.t("prefs.hotkey.tapFailed"))
        #expect(model.hotkeys.message("speakHotkey") == model.t("prefs.hotkey.registerFailed"))
        #expect(model.hotkeys.message("composeHotkey") == nil)
    }
}

@Suite("设置窗：预设、术语表、高级")
@MainActor
struct SettingsEditorsTests {
    @Test func 保存预设写回customStyles并刷新风格目录() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        let before = backend.stylesReloaded
        model.presets.startNew(now: 36)
        model.presets.editing?.label = "简洁"
        model.presets.temperatureText = "9"
        await model.presets.save()
        #expect(model.presets.editing == nil)
        #expect(model.presets.list.map(\.label) == ["简洁"])
        #expect(model.presets.list.first?.temperature == 2)
        #expect(model.presets.list.first?.id == "custom-10")
        #expect(backend.stylesReloaded == before + 1)
    }

    @Test func 预设被Rust拒绝时编辑器留着并说明原因() async {
        let backend = FakeBackend(base)
        backend.rejectKeys = ["customStyles"]
        let model = await loaded(backend)
        model.presets.startNew(now: 1)
        await model.presets.save()
        #expect(model.presets.editing != nil)
        #expect(model.presets.error == "customStyles 不合法")
    }

    @Test func 预设里不认识的字段编辑后保留() async {
        var settings = base
        settings["customStyles"] = .array([.object([
            "id": .string("custom-1"), "label": .string("旧"), "temperature": .number(0.5), "future": .bool(true),
        ])])
        let backend = FakeBackend(settings)
        let model = await loaded(backend)
        model.presets.edit(model.presets.list[0])
        model.presets.editing?.label = "新"
        await model.presets.save()
        let saved = backend.stored.array("customStyles").first?.objectValue
        #expect(saved?["future"] == .bool(true))
        #expect(saved?["label"] == .string("新"))
        #expect(saved?["temperature"] == .number(0.5))
    }

    @Test func 术语表先存表再导入条目只存名称时不导入() async {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.glossaries.startNew(now: 1)
        model.glossaries.editing?.name = "产品"
        model.glossaries.text = "API\t接口\ncache\t缓存"
        await model.glossaries.save(withEntries: true)
        #expect(backend.calls == ["saveGlossary:glossary-1", "importGlossary:glossary-1"])
        #expect(model.glossaries.status == model.t("prefs.glossary.savedWithCount", ["name": "产品", "count": "2"]))
        #expect(model.glossaries.editing == nil)
        #expect(model.glossaries.lists.map(\.id) == ["glossary-1"])

        model.glossaries.edit(model.glossaries.lists[0])
        await model.glossaries.save(withEntries: false)
        #expect(backend.calls.last == "saveGlossary:glossary-1")
    }

    @Test func 复制CSV走剪贴板接缝从文件读入只填编辑框() async {
        let backend = FakeBackend(base)
        backend.lists = [Glossary(id: "g", name: "表")]
        let model = await loaded(backend)
        await model.glossaries.reload()
        await model.glossaries.copyCsv(model.glossaries.lists[0])
        #expect(backend.copied == ["source,target\ng,x"])
        #expect(model.glossaries.status == model.t("prefs.glossary.copied"))

        model.glossaries.loadFile(name: "厂商术语", contents: "a,b")
        #expect(model.glossaries.editing?.name == "厂商术语")
        #expect(model.glossaries.text == "a,b")
        #expect(!backend.calls.contains { $0.hasPrefix("importGlossary") })
    }

    @Test func 删除术语表() async {
        let backend = FakeBackend(base)
        backend.lists = [Glossary(id: "g", name: "表")]
        let model = await loaded(backend)
        await model.glossaries.reload()
        model.glossaries.edit(model.glossaries.lists[0])
        await model.glossaries.remove(model.glossaries.lists[0])
        #expect(model.glossaries.lists.isEmpty)
        #expect(model.glossaries.editing == nil)
    }

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

    @Test func 月度上限填坏数字不提交清空是清除() async throws {
        var settings = base
        settings["monthlyLimits"] = .array([.object(["providerId": .string("openai"), "limitUsd": .number(5)])])
        let backend = FakeBackend(settings)
        let model = await loaded(backend)
        #expect(model.advanced.commitLimit("openai", "10,5") == nil)
        #expect(model.advanced.limitError == model.t("prefs.invalidNumber"))
        #expect(backend.patches.isEmpty)
        try await model.advanced.commitLimit("openai", "")?.value
        #expect(backend.stored.array("monthlyLimits").isEmpty)
        #expect(model.advanced.limitError == nil)
    }

    @Test func 保留天数取整负数归零() async throws {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        try await model.advanced.commitRetention("-3")?.value
        #expect(backend.patches.last == ["historyRetentionDays": .number(0)])
        #expect(model.advanced.commitRetention("abc") == nil)
    }

    @Test func 场景模型提交时对比模型与未知键原样带上() async throws {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.routing.drafts[.ocr] = ModelRef(providerId: "deepseek", model: "chat")
        model.routing.commitScene(.ocr)
        await eventually { !backend.patches.isEmpty }
        let scenes = backend.stored.object("sceneModels")
        #expect(scenes["ocr"]?.modelRef == ModelRef(providerId: "deepseek", model: "chat"))
        #expect(scenes["futureScene"] == .string("keep"))
        #expect(scenes["compare"] == .array([]))
    }

    @Test func 对比模型加重复项被忽略且草稿清空() async throws {
        let backend = FakeBackend(base)
        let model = await loaded(backend)
        model.routing.compareDraft = ModelRef(providerId: "openai", model: "gpt-4o")
        model.routing.addCompare()
        await eventually { backend.patches.count == 1 }
        model.routing.compareDraft = ModelRef(providerId: "openai", model: "gpt-4o")
        model.routing.addCompare()
        await eventually { backend.patches.count == 2 }
        #expect(model.routing.compareModels == [ModelRef(providerId: "openai", model: "gpt-4o")])
        #expect(model.routing.compareDraft == ModelRef(providerId: "", model: ""))
        #expect(backend.stored.object("sceneModels")["futureScene"] == .string("keep"))
    }
}

@Suite("设置窗：每一页都画得出来")
@MainActor
struct SettingsViewRenderTests {
    @Test(arguments: SettingsTab.allCases)
    func 每一页在三套主题下渲染不崩(tab: SettingsTab) async {
        var settings = base
        settings["targetLangMode"] = .string("perApp")
        settings["appTargetLangs"] = .object(["Slack": .string("en")])
        settings["customStyles"] = .array([CustomStyle(id: "custom-1", label: "简洁").json])
        settings["monthlyLimits"] = .array([.object(["providerId": .string("openai"), "limitUsd": .number(1)])])
        let backend = FakeBackend(settings)
        backend.lists = [Glossary(id: "g", name: "表")]
        let model = await loaded(backend)
        model.tab = tab
        model.presets.startNew(now: 1)
        model.glossaries.startNew(now: 1)
        for theme in ["light", "dark", "highContrast"] {
            model.commit(["theme": .string(theme)])
            let renderer = ImageRenderer(content: SettingsView(model: model).frame(width: 840, height: 700))
            #expect(renderer.nsImage != nil, "\(tab) / \(theme)")
        }
    }
}
