import Foundation
import Testing
import UmuoCore
@testable import Umuo

// 首次引导的视图模型：语言与引擎经 applySettingsPatch 只交改了的键（审查 H6：存 Key 后连首选与默认模型一起存）、
// 本机 Ollama / LM Studio 探测、不抢已能用的首选、结束前等最后一次保存、走完记下 onboardingDone 并关窗。
// 假 backend 只记调用：不碰真实 Keychain、TCC 与网络。

private struct Rejected: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

@MainActor
private class FakeOnboarding: OnboardingBackend {
    var stored: SettingsValues
    var patches: [SettingsValues] = []
    var rejectKeys: Set<String> = []
    var keys: [String: String] = [:]
    /// 供应商 → 模型列表；不在表里的当作连不上。
    var local: [String: [String]] = [:]
    var listed: [String] = []
    var perms = PermissionStatus(accessibility: false, screenRecording: false)
    var calls: [String] = []
    var closed = 0
    var translated: [String] = []
    var translateError: Error?
    /// 保存前的等待（模拟一次慢保存，看「结束」会不会等它）。
    var saveDelay: Duration?
    /// 探测本机模型的等待（模拟探测结果在引导结束之后才回来）。
    var listDelay: Duration?
    /// 控制 Key 状态返回的时刻，覆盖等待期间结束引导与更换首选的竞争。
    var holdKeyChecks = false
    var waitingKey: CheckedContinuation<Bool, Never>?
    var holdKeySaves = false
    var waitingSave: CheckedContinuation<Void, Never>?
    var keySaveFailure: Error?

    init(_ stored: SettingsValues) { self.stored = stored }

    func loadSettings() async throws -> SettingsValues { stored }

    func applyPatch(_ patch: SettingsValues) async throws -> SettingsValues {
        if let saveDelay { try? await Task.sleep(for: saveDelay) }
        await Task.yield()
        patches.append(patch)
        if let bad = patch.keys.first(where: rejectKeys.contains) { throw Rejected(message: "\(bad) 不合法") }
        stored.merge(patch) { _, new in new }
        return stored
    }

    func providers() async -> [ProviderDetail] {
        [
            ProviderDetail(id: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini", suggestedModels: [],
                           keysUrl: "https://platform.openai.com/api-keys", requiresKey: true, requiresBaseUrl: false,
                           local: false),
            ProviderDetail(id: "anthropic", label: "Anthropic", defaultModel: "claude-3-5-haiku-latest", suggestedModels: [],
                           keysUrl: "", requiresKey: true, requiresBaseUrl: false, local: false),
            ProviderDetail(id: "ollama", label: "Ollama", defaultModel: "qwen2.5", suggestedModels: [], keysUrl: "",
                           requiresKey: false, requiresBaseUrl: false, local: true),
            ProviderDetail(id: "lmstudio", label: "LM Studio", defaultModel: "", suggestedModels: [], keysUrl: "",
                           requiresKey: false, requiresBaseUrl: false, local: true),
            // 与内核一致：Azure 的「模型」是用户自己起的部署名，没有默认模型
            ProviderDetail(id: "azure", label: "Azure OpenAI", defaultModel: "", suggestedModels: [],
                           keysUrl: "", requiresKey: true, requiresBaseUrl: true, local: false),
            ProviderDetail(id: "custom", label: "自定义端点", defaultModel: "", suggestedModels: [], keysUrl: "",
                           requiresKey: true, requiresBaseUrl: true, local: false),
        ]
    }

    func keyStatus(_ providerId: String) async throws -> Bool {
        if holdKeyChecks { return await withCheckedContinuation { waitingKey = $0 } }
        return keys[providerId] != nil
    }
    func saveApiKey(_ providerId: String, _ key: String) async throws {
        if holdKeySaves { await withCheckedContinuation { waitingSave = $0 } }
        if let keySaveFailure { throw keySaveFailure }
        keys[providerId] = key
    }

    func listModels(_ providerId: String) async throws -> [String] {
        listed.append(providerId)
        if let listDelay { try? await Task.sleep(for: listDelay) }
        guard let models = local[providerId] else { throw Rejected(message: "连不上") }
        return models
    }

    func permissions() async -> PermissionStatus { perms }
    func requestScreenRecording() async { calls.append("requestScreen") }
    func openSystemSettings(_ permission: PermissionKind) { calls.append("open:\(permission.rawValue)") }
    func openURL(_ url: String) { calls.append("url:\(url)") }

    func translateSample(_ text: String) throws {
        if let translateError { throw translateError }
        translated.append(text)
    }

    func close() { closed += 1 }
}

private let defaults: SettingsValues = [
    "providerId": .string("openai"), "model": .string("gpt-4o-mini"), "targetLang": .string("zh-CN"),
    "secondaryTargetLang": .string("en"), "onboardingDone": .bool(false), "selectionHotkey": .string("Alt+D"),
]

@MainActor
private func loaded(_ backend: FakeOnboarding) async -> OnboardingModel {
    let model = OnboardingModel(backend: backend)
    model.t = Translate(locale: .zhCN)
    await model.load()
    return model
}

/// 等队列里的保存落定。
@MainActor
private func settle() async {
    for _ in 0 ..< 30 { await Task.yield() }
}

@MainActor
@Suite("首次引导视图模型")
struct OnboardingModelTests {
    @Test func 保存Key期间换供应商_不清空新草稿或改变首选() async throws {
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        backend.holdKeySaves = true
        model.draftKey = "openai-key"
        let pending = Task { await model.saveKey() }
        await settle()
        let gate = try #require(backend.waitingSave)
        model.draftProvider = "anthropic"
        model.draftKey = "新草稿"
        await settle()
        gate.resume()
        await pending.value
        await settle()
        #expect(backend.keys["openai"] == "openai-key", "已发出的 Keychain 写入仍归原供应商")
        #expect(model.draftKey == "新草稿")
        #expect(!model.keyConfigured)
        #expect(backend.patches.isEmpty)
    }

    @Test func 同一供应商改了模型草稿_旧Key结果也不覆盖() async throws {
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        model.draftProvider = "custom"
        model.draftModel = "旧模型"
        model.draftKey = "key"
        backend.holdKeySaves = true
        let pending = Task { await model.saveKey() }
        await settle()
        let gate = try #require(backend.waitingSave)
        model.draftModel = "新模型"
        gate.resume()
        await pending.value
        await settle()
        #expect(model.draftKey == "key")
        #expect(model.draftModel == "新模型")
        #expect(backend.patches.isEmpty)
    }

    @Test func 引导结束后保存Key才返回_不再写首选或显示迟到错误() async throws {
        for fails in [true, false] {
            let backend = FakeOnboarding(defaults)
            let model = await loaded(backend)
            model.draftProvider = "anthropic"
            model.draftKey = "key"
            backend.holdKeySaves = true
            if fails { backend.keySaveFailure = Rejected(message: "迟到错误") }
            let pending = Task { await model.saveKey() }
            await settle()
            let gate = try #require(backend.waitingSave)
            await model.finish()
            let notice = model.notice
            gate.resume()
            await pending.value
            await settle()
            #expect(backend.closed == 1)
            #expect(backend.patches == [["onboardingDone": .bool(true)]])
            #expect(model.notice == notice)
        }
    }

    @Test func 载入后从欢迎页开始且草稿供应商是当前首选() async {
        let model = await loaded(FakeOnboarding(defaults))
        #expect(model.isLoaded)
        #expect(model.step == .welcome)
        #expect(model.draftProvider == "openai")
        #expect(!model.keyConfigured)
        #expect(model.state.progress == (2, 5)) // 欢迎页 + 已有第一目标语言
    }

    @Test func 读不到设置时停在载入页并说明原因() async {
        final class Failing: FakeOnboarding {
            override func loadSettings() async throws -> SettingsValues { throw Rejected(message: "内核启动失败") }
        }
        let model = await loaded(Failing(defaults))
        #expect(!model.isLoaded)
        #expect(model.notice == "读取设置失败：内核启动失败")
    }

    @Test func 不阻止前进且第一页没有上一步() async {
        let model = await loaded(FakeOnboarding(defaults))
        model.previous()
        #expect(model.step == .welcome)
        for _ in 0 ..< 10 { model.next() }
        // 一步都没完成也能走到最后
        #expect(model.step == .practice)
    }

    @Test func 改语言只交那一个键() async {
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        model.commit(["targetLang": .string("ja")])
        #expect(model.values.string("targetLang") == "ja")
        await settle()
        #expect(backend.patches == [["targetLang": .string("ja")]])
    }

    @Test func 存Key后首选与模型一起换成这家() async {
        // 审查 H6：只存 Key 不改首选的话，第一次划词仍走出厂的 OpenAI，报「缺少 Key」；沿用上一家的模型名会 404
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        model.draftProvider = "anthropic"
        model.draftKey = "  sk-ant-1  "
        await model.saveKey()
        await settle()
        #expect(backend.keys["anthropic"] == "sk-ant-1")
        #expect(backend.patches == [["providerId": .string("anthropic"), "model": .string("claude-3-5-haiku-latest")]])
        #expect(model.keyConfigured)
        #expect(model.draftKey.isEmpty)
        #expect(model.notice == "已保存 Anthropic 的 Key")
    }

    @Test func 自定义端点要填地址与模型_地址写进customBaseUrl_存Key用填写的模型() async {
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        #expect(!model.needsEndpoint, "OpenAI 不需要地址框")
        model.draftProvider = "custom"
        #expect(model.needsEndpoint)
        _ = try? await model.saveEndpoint("  https://gateway.internal/v1  ")?.value
        #expect(backend.patches.last == ["customBaseUrl": .string("https://gateway.internal/v1")])
        #expect(model.draftEndpoint == "https://gateway.internal/v1")
        model.draftModel = " qwen-max "
        model.draftKey = "sk-c"
        await model.saveKey()
        await settle()
        #expect(backend.keys["custom"] == "sk-c")
        #expect(backend.patches.last == ["providerId": .string("custom"), "model": .string("qwen-max")])
    }

    @Test func Azure的端点写进providerBaseUrls且不动其他家的地址() async {
        var values = defaults
        values["providerBaseUrls"] = .object(["custom-gw": .string("https://x/v1")])
        let backend = FakeOnboarding(values)
        let model = await loaded(backend)
        model.draftProvider = "azure"
        #expect(model.needsEndpoint)
        _ = try? await model.saveEndpoint("https://res.openai.azure.com")?.value
        #expect(backend.patches.last == ["providerBaseUrls": .object([
            "custom-gw": .string("https://x/v1"), "azure": .string("https://res.openai.azure.com"),
        ])])
        #expect(model.draftEndpoint == "https://res.openai.azure.com")
    }

    @Test func 需要端点的供应商没填模型时不写空模型() async {
        // Azure 与自定义端点都没有默认模型：写进 "" 会让第一次翻译直接报缺模型
        for providerId in ["azure", "custom"] {
            let backend = FakeOnboarding(defaults)
            let model = await loaded(backend)
            model.draftProvider = providerId
            model.draftKey = "k"
            await model.saveKey()
            await settle()
            #expect(backend.keys[providerId] == "k")
            #expect(backend.patches.last == ["providerId": .string(providerId)], "\(providerId)")
        }
    }

    @Test func 重新运行引导换Key不把改过的模型或Azure部署名改回默认() async {
        for (providerId, custom) in [("azure", "my-deploy"), ("openai", "gpt-4o")] {
            var values = defaults
            values["providerId"] = .string(providerId)
            values["model"] = .string(custom)
            let backend = FakeOnboarding(values)
            let model = await loaded(backend)
            #expect(model.draftProvider == providerId)
            model.draftKey = "sk-new"
            await model.saveKey()
            await settle()
            #expect(backend.keys[providerId] == "sk-new")
            #expect(backend.patches.last?["model"] == nil, "\(providerId)")
            #expect(backend.stored.string("model") == custom, "\(providerId)")
        }
    }

    @Test func 换了下拉里的供应商就清掉没保存的Key草稿() async {
        // 草稿是给上一个供应商填的：不清掉的话按「保存」会把它存到新供应商名下
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        model.draftKey = "sk-typed-for-openai"
        model.draftProvider = "anthropic"
        #expect(model.draftKey.isEmpty)
        await model.saveKey()
        #expect(backend.keys.isEmpty)
    }

    @Test func Key状态跟着下拉里选的供应商() async {
        let backend = FakeOnboarding(defaults)
        backend.keys = ["anthropic": "sk-ant"]
        let model = await loaded(backend)
        #expect(model.keyConfigured == false)
        model.draftProvider = "anthropic"
        await settle()
        #expect(model.keyConfigured == true)
        model.draftProvider = "openai"
        await settle()
        #expect(model.keyConfigured == false)
    }

    @Test func 首选是不需要Key的本机引擎时重新运行引导也算有引擎() async {
        // 与设置窗同一条规则：本机模型不需要 Key，算已配
        for providerId in ["ollama", "lmstudio"] {
            var values = defaults
            values["providerId"] = .string(providerId)
            values["model"] = .string("qwen3-8b")
            let model = await loaded(FakeOnboarding(values))
            #expect(model.state.hasUsableEngine == true, "\(providerId)")
            #expect(OnboardingStep.model.isSatisfied(model.state) == true, "\(providerId)")
        }
    }

    @Test func 下拉草稿有Key或不需要Key也不能代替未配置的首选() async {
        for providerId in ["ollama", "anthropic"] {
            let backend = FakeOnboarding(defaults)
            backend.keys["anthropic"] = "sk-ant"
            let model = await loaded(backend)
            model.draftProvider = providerId
            await model.refreshKeyStatus()
            #expect(model.keyConfigured)
            #expect(!model.state.hasUsableEngine)
            #expect(!OnboardingStep.model.isSatisfied(model.state))
            #expect(backend.stored.string("providerId") == "openai")
            #expect(backend.patches.isEmpty)
        }
    }

    @Test func 首选可用时切到缺Key草稿不应丢掉完成度() async {
        let backend = FakeOnboarding(defaults)
        backend.keys["openai"] = "sk"
        let model = await loaded(backend)
        model.draftProvider = "anthropic"
        await model.refreshKeyStatus()
        #expect(!model.keyConfigured)
        #expect(model.state.hasUsableEngine)
    }

    @Test func 检测到本机模型但保存失败不能算有引擎() async {
        let backend = FakeOnboarding(defaults)
        backend.rejectKeys = ["providerId"]
        backend.local = ["ollama": ["qwen"]]
        let model = await loaded(backend)
        await model.detectLocal()
        await settle()
        #expect(model.localModel != nil)
        #expect(!model.state.hasUsableEngine)
        #expect(backend.stored.string("providerId") == "openai")
    }

    @Test func 空白Key不保存() async {
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        model.draftKey = "   "
        await model.saveKey()
        #expect(backend.keys.isEmpty)
        #expect(backend.patches.isEmpty)
    }

    @Test func 首选用不了时探测到Ollama就换成它() async {
        let backend = FakeOnboarding(defaults)
        backend.local = ["ollama": ["qwen2.5:7b", "llama3"]]
        let model = await loaded(backend)
        await model.detectLocal()
        await settle()
        #expect(model.localModel == EngineChoice(providerId: "ollama", model: "qwen2.5:7b"))
        #expect(model.notice == "检测到本机模型：qwen2.5:7b（Ollama）", "与别家一样统一显示「模型（供应商）」")
        #expect(backend.patches == [["providerId": .string("ollama"), "model": .string("qwen2.5:7b")]])
        #expect(model.state.hasUsableEngine)
    }

    @Test func 引导结束后才回来的探测结果不再改首选() async {
        let backend = FakeOnboarding(defaults)
        backend.local = ["ollama": ["qwen2.5:7b"]]
        backend.listDelay = .milliseconds(50)
        let model = await loaded(backend)
        let detecting = Task { await model.detectLocal() }
        await model.finish()
        #expect(backend.closed == 1)
        await detecting.value
        await settle()
        #expect(backend.patches == [["onboardingDone": .bool(true)]])
        #expect(backend.stored["providerId"] == .string("openai"))
    }

    @Test func 关掉引导窗后才回来的探测结果也不改首选() async {
        let backend = FakeOnboarding(defaults)
        backend.local = ["ollama": ["qwen2.5:7b"]]
        backend.listDelay = .milliseconds(50)
        let model = await loaded(backend)
        let detecting = Task { await model.detectLocal() }
        await Task.yield()
        model.windowClosed()
        await detecting.value
        await settle()
        #expect(backend.patches.isEmpty)
    }

    @Test func 等Key状态时结束或关窗也不能让探测结果改首选() async throws {
        for closeWindow in [false, true] {
            let backend = FakeOnboarding(defaults)
            backend.local = ["ollama": ["qwen"]]
            let model = await loaded(backend)
            await settle()
            backend.holdKeyChecks = true
            let detecting = Task { await model.detectLocal() }
            for _ in 0 ..< 1000 where backend.waitingKey == nil { await Task.yield() }
            let waiting = try #require(backend.waitingKey)
            backend.holdKeyChecks = false
            if closeWindow { model.windowClosed() } else { await model.finish() }
            waiting.resume(returning: false)
            backend.waitingKey = nil
            await detecting.value
            await settle()
            #expect(backend.stored.string("providerId") == "openai")
            #expect(backend.patches == (closeWindow ? [] : [["onboardingDone": .bool(true)]]))
        }
    }

    @Test func 等Key状态期间换了首选就丢弃旧探测决策() async throws {
        let backend = FakeOnboarding(defaults)
        backend.local = ["ollama": ["qwen"]]
        backend.keys["anthropic"] = "sk-ant"
        let model = await loaded(backend)
        await settle()
        backend.holdKeyChecks = true
        let detecting = Task { await model.detectLocal() }
        for _ in 0 ..< 1000 where backend.waitingKey == nil { await Task.yield() }
        let waiting = try #require(backend.waitingKey)
        backend.holdKeyChecks = false
        let patch: SettingsValues = ["providerId": .string("anthropic"), "model": .string("claude")]
        let saving = model.commitTask(patch)
        try await saving?.value
        waiting.resume(returning: false)
        backend.waitingKey = nil
        await detecting.value
        await settle()
        #expect(backend.patches == [patch])
        #expect(backend.stored.string("providerId") == "anthropic")
    }

    @Test func Ollama没有就试LMStudio并标出是哪家() async {
        let backend = FakeOnboarding(defaults)
        backend.local = ["ollama": [], "lmstudio": ["qwen3-8b"]]
        let model = await loaded(backend)
        await model.detectLocal()
        await settle()
        #expect(backend.listed == ["ollama", "lmstudio"])
        #expect(model.localModel == EngineChoice(providerId: "lmstudio", model: "qwen3-8b"))
        #expect(model.notice == "检测到本机模型：qwen3-8b（LM Studio）")
        #expect(backend.patches == [["providerId": .string("lmstudio"), "model": .string("qwen3-8b")]])
    }

    @Test func 下拉选了本机供应商再探测_仍按首选有没有Key决定换不换() async {
        // Key 状态跟着下拉走、本机供应商算已配；但「首选此刻能不能用」看的是存着的首选，不是下拉
        let backend = FakeOnboarding(defaults)
        backend.local = ["ollama": ["qwen2.5:7b"]]
        let model = await loaded(backend)
        model.draftProvider = "ollama"
        await settle()
        await model.detectLocal()
        await settle()
        #expect(backend.patches == [["providerId": .string("ollama"), "model": .string("qwen2.5:7b")]])
    }

    @Test func 首选已能用时探测到本机模型也不抢() async {
        let backend = FakeOnboarding(defaults)
        backend.keys = ["openai": "sk"]
        backend.local = ["ollama": ["qwen2.5:7b"]]
        let model = await loaded(backend)
        #expect(model.keyConfigured)
        await model.detectLocal()
        await settle()
        #expect(model.localModel != nil)
        #expect(backend.patches.isEmpty)
    }

    @Test func 首选本来就是本机供应商时不覆盖他挑的模型() async {
        var values = defaults
        values["providerId"] = .string("ollama")
        values["model"] = .string("my-model")
        let backend = FakeOnboarding(values)
        backend.local = ["ollama": ["other"]]
        let model = await loaded(backend)
        await model.detectLocal()
        await settle()
        #expect(backend.patches.isEmpty)
    }

    @Test func 在跑但没有模型与压根没检测到说法不同() async {
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        await model.detectLocal()
        #expect(model.notice == model.t("onboarding.localMissing"))
        #expect(model.localModel == nil)
        backend.local = ["lmstudio": []]
        await model.detectLocal()
        #expect(model.notice == model.t("onboarding.localNoModels"))
    }

    @Test func 翻一句看看走真实流水线() async {
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        model.practice()
        #expect(backend.translated == [OnboardingModel.sampleText])
        #expect(model.practiced)
        #expect(OnboardingStep.practice.isSatisfied(model.state))

        backend.translateError = Rejected(message: "没有 Key")
        let again = await loaded(backend)
        again.practice()
        #expect(!again.practiced)
        #expect(again.notice == "没有 Key")
    }

    @Test func 权限只在点了请求时才申请并重新检查() async {
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        #expect(model.permissions.accessibility == false)
        backend.perms = PermissionStatus(accessibility: true, screenRecording: true)
        await model.requestScreenRecording()
        #expect(backend.calls == ["requestScreen"])
        #expect(model.state.accessibilityTrusted)
        #expect(OnboardingStep.permissions.isSatisfied(model.state))
    }

    @Test func 结束前等最后一次保存再记下走完并关窗() async {
        let backend = FakeOnboarding(defaults)
        backend.saveDelay = .milliseconds(30)
        let model = await loaded(backend)
        model.commit(["targetLang": .string("ja")])
        await model.finish()
        #expect(backend.patches == [["targetLang": .string("ja")], ["onboardingDone": .bool(true)]])
        #expect(backend.closed == 1)
    }

    @Test func 没有引擎也可以结束() async {
        let backend = FakeOnboarding(defaults)
        let model = await loaded(backend)
        #expect(!model.state.hasUsableEngine)
        await model.finish()
        #expect(backend.stored["onboardingDone"] == .bool(true))
        #expect(backend.closed == 1)
    }

    @Test func 记不下走完时不关窗并说明原因() async {
        let backend = FakeOnboarding(defaults)
        backend.rejectKeys = ["onboardingDone"]
        let model = await loaded(backend)
        await model.finish()
        #expect(backend.closed == 0)
        #expect(model.notice == "onboardingDone 不合法")
    }

    @Test func 前面的保存失败了也照样结束() async {
        let backend = FakeOnboarding(defaults)
        backend.rejectKeys = ["targetLang"]
        let model = await loaded(backend)
        model.commit(["targetLang": .string("xx")])
        await model.finish()
        #expect(backend.closed == 1)
        // 失败的那个字段退回存好的值
        #expect(model.values.string("targetLang") == "zh-CN")
    }
}

@Suite("首次引导：挑本机模型")
struct PickLocalTests {
    @Test func 按顺序挑第一家有模型的() {
        #expect(Onboarding.pickLocal([("ollama", .models(["a"])), ("lmstudio", .models(["b"]))])
            == .success(EngineChoice(providerId: "ollama", model: "a")))
        #expect(Onboarding.pickLocal([("ollama", .unreachable), ("lmstudio", .models(["b", "c"]))])
            == .success(EngineChoice(providerId: "lmstudio", model: "b")))
    }

    @Test func 没挑出来时区分在跑没模型与没检测到() {
        #expect(Onboarding.pickLocal([("ollama", .models([])), ("lmstudio", .unreachable)]) == .failure(.noModels))
        #expect(Onboarding.pickLocal([("ollama", .unreachable), ("lmstudio", .unreachable)]) == .failure(.missing))
        #expect(Onboarding.pickLocal([]) == .failure(.missing))
    }

    @Test func 先Ollama后LMStudio() {
        #expect(Onboarding.localProviders == ["ollama", "lmstudio"])
    }

    @Test func 探测到的供应商写进默认引擎() {
        #expect(Onboarding.engineForLocalModel("m", providerId: "lmstudio", keyConfigured: false, requiresKey: true)
            == EngineChoice(providerId: "lmstudio", model: "m"))
    }
}
