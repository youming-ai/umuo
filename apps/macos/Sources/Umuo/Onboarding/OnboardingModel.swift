import Foundation
import Observation
import UmuoCore

/// 首次引导往外要做的事。正式实现是 `EngineOnboardingBackend`（转给设置窗的 `EngineSettingsBackend`，
/// Keychain、权限、模型列表只有一份实现），测试换成只记调用的假实现——不碰真实 Keychain、TCC 与网络。
@MainActor
protocol OnboardingBackend: AnyObject {
    func loadSettings() async throws -> SettingsValues
    /// 只交改了的顶层键（`applySettingsPatch`），返回规范化之后的整份设置。
    func applyPatch(_ patch: SettingsValues) async throws -> SettingsValues
    func providers() async -> [ProviderDetail]
    func keyStatus(_ providerId: String) async throws -> Bool
    func saveApiKey(_ providerId: String, _ key: String) async throws
    func listModels(_ providerId: String) async throws -> [String]
    func permissions() async -> PermissionStatus
    func requestScreenRecording() async
    func openSystemSettings(_ permission: PermissionKind)
    func openURL(_ url: String)
    /// 「翻一句看看」：走与划词完全相同的流水线，浮窗弹出来显示结果。
    func translateSample(_ text: String) throws
    /// 引导走完：关掉窗口（关掉而不是隐藏：之后用「重新运行首次引导」再打开）。
    func close()
}

/// 首次启动引导的视图模型（PRD §7.4，ARCHITECTURE §4.11）。
///
/// 两条刻意的产品规则：**不阻止前进**（权限可以稍后授予、模型可以稍后再配），**但要说清后果**
/// （一个引擎都没有时最后一页写明「现在结束的话翻不了任何东西」）。
///
/// 引导里改的语言与引擎都**真的写进设置**（审查 H6），与设置窗同一条 `SettingsQueue`：逐个保存、每次只交自己改的键、
/// 失败时界面退回存好的值。结束前等最后一次保存落定，否则窗口关掉时最后一次改动可能还在路上。
@MainActor @Observable
final class OnboardingModel {
    /// 引导里用的示例句：一句常见的英文，够短、看一眼就知道翻得对不对。
    static let sampleText = "The quick brown fox jumps over the lazy dog."

    let backend: OnboardingBackend
    var step = OnboardingStep.welcome
    private(set) var queue: SettingsQueue<JSONValue>?
    private(set) var providers: [ProviderDetail] = []
    private(set) var keyConfigured = false
    /// 探测到的本机模型（供应商 + 模型名）。
    private(set) var localModel: EngineChoice?
    private(set) var detecting = false
    private(set) var permissions = PermissionStatus()
    private(set) var practiced = false
    var notice: String?

    /// 模型这一步的草稿：选中的供应商与还没保存的 Key。
    /// 换供应商就清掉 Key 草稿：它属于上一个供应商，留着的话按「保存」会把它存到新供应商名下。
    var draftProvider = "" {
        didSet { if draftProvider != oldValue { draftKey = "" } }
    }
    var draftKey = ""
    /// 需要端点的供应商（Azure、自定义端点）要自己填的模型名：自定义端点没有默认模型，Azure 是部署名。
    var draftModel = ""

    var t = Translate(locale: .source)

    @ObservationIgnored private var lastSave: Task<Void, Error>?

    init(backend: OnboardingBackend) {
        self.backend = backend
    }

    var values: SettingsValues { queue?.current ?? [:] }
    var isLoaded: Bool { queue != nil }

    var state: OnboardingState {
        OnboardingState(targetLang: values.string("targetLang"), keyConfigured: keyConfigured,
                        localModelFound: localModel != nil, accessibilityTrusted: permissions.accessibility == true,
                        screenRecordingGranted: permissions.screenRecording == true, practiced: practiced)
    }

    var draftDetail: ProviderDetail? { providers.first { $0.id == draftProvider } }

    /// 选中的供应商要不要用户填地址（Azure 的资源终结点、自定义端点；判定来自内核的 `requires_base_url`）。
    var needsEndpoint: Bool { draftDetail?.requiresBaseUrl ?? false }

    /// 已保存的地址：与设置的引擎页同一份——Azure 在 `providerBaseUrls.azure`，自定义端点在 `customBaseUrl`。
    var draftEndpoint: String {
        draftProvider == "azure" ? values.object("providerBaseUrls").string("azure") : values.string("customBaseUrl")
    }

    /// 打开窗口时载入。失败时页面停在载入页并说明原因。
    func load() async {
        do {
            let current = try await backend.loadSettings()
            providers = await backend.providers()
            queue = SettingsQueue(initial: current) { [backend] patch in try await backend.applyPatch(patch) }
            draftProvider = current.string("providerId")
            permissions = await backend.permissions()
            keyConfigured = (try? await backend.keyStatus(current.string("providerId"))) ?? false
        } catch {
            notice = t("onboarding.settingsFailed", ["reason": SettingsRules.message(error)])
        }
    }

    func commit(_ patch: SettingsValues) {
        _ = commitTask(patch)
    }

    /// 同 `commit`，但把保存任务交回去：草稿输入框据此在失败时退回原值。
    @discardableResult
    func commitTask(_ patch: SettingsValues) -> Task<Void, Error>? {
        guard let queue else { return nil }
        let task = queue.commit(patch)
        lastSave = task
        Task {
            do { try await task.value } catch { self.notice = SettingsRules.message(error) }
        }
        return task
    }

    /// 保存选中供应商的地址，写法与设置的引擎页一致；不合法的地址由内核拒绝，原因显示在提示行。
    func saveEndpoint(_ url: String) -> Task<Void, Error>? {
        let url = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if draftProvider == "azure" {
            var urls = values.object("providerBaseUrls")
            urls["azure"] = .string(url)
            return commitTask(["providerBaseUrls": .object(urls)])
        }
        return commitTask(["customBaseUrl": .string(url)])
    }

    // MARK: - 步骤

    func next() { if let next = step.next { step = next } }
    func previous() { if let previous = step.previous { step = previous } }

    // MARK: - 模型

    /// 存 Key 之后首选换成这家、模型用它的默认模型（`engineForSavedKey`，审查 H6）。
    func saveKey() async {
        let key = draftKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        let providerId = draftProvider
        let detail = draftDetail
        do {
            try await backend.saveApiKey(providerId, key)
            draftKey = ""
            keyConfigured = true
            // 需要端点的供应商用用户填的模型（自定义端点没有默认模型，空着存会让首次翻译直接报缺模型）
            let typed = draftModel.trimmingCharacters(in: .whitespacesAndNewlines)
            let chosen = needsEndpoint && !typed.isEmpty ? typed : detail?.defaultModel
            let engine = Onboarding.engineForSavedKey(providerId: providerId, defaultModel: chosen)
            commit(["providerId": .string(engine.providerId), "model": .string(engine.model)])
            notice = t("onboarding.keySaved", ["provider": detail?.label ?? providerId])
        } catch {
            notice = SettingsRules.message(error)
        }
    }

    /// 探测本机的 Ollama / LM Studio（拉模型列表要走网络，后端在后台做）。探测到了、且首选此刻用不了，才把首选换成它。
    func detectLocal() async {
        guard !detecting else { return }
        detecting = true
        defer { detecting = false }
        var probes: [(providerId: String, probe: Onboarding.LocalProbe)] = []
        for providerId in Onboarding.localProviders {
            do { probes.append((providerId, .models(try await backend.listModels(providerId)))) } catch {
                probes.append((providerId, .unreachable))
            }
        }
        switch Onboarding.pickLocal(probes) {
        case let .success(found):
            localModel = found
            notice = t("onboarding.detectedModel", ["model": detectedLabel(found)])
            let current = values.string("providerId")
            let requiresKey = providers.first { $0.id == current }?.requiresKey ?? true
            if let engine = Onboarding.engineForLocalModel(found.model, providerId: found.providerId,
                                                           keyConfigured: keyConfigured, requiresKey: requiresKey)
            {
                commit(["providerId": .string(engine.providerId), "model": .string(engine.model)])
            }
        case let .failure(miss):
            localModel = nil
            notice = miss == .noModels ? t("onboarding.localNoModels") : t("onboarding.localMissing")
        }
    }

    /// 探测结果的显示：一律「模型（供应商）」，看得出是哪一家本机服务上的模型。
    func detectedLabel(_ found: EngineChoice) -> String {
        let label = providers.first { $0.id == found.providerId }?.label ?? found.providerId
        return t("onboarding.modelWithProvider", ["model": found.model, "provider": label])
    }

    // MARK: - 权限

    func recheckPermissions() async {
        permissions = await backend.permissions()
    }

    /// 屏幕录制的系统对话框一个进程只弹一次：只在用户点了「请求授权」时才调。
    func requestScreenRecording() async {
        await backend.requestScreenRecording()
        await recheckPermissions()
    }

    // MARK: - 试一试与结束

    func practice() {
        do {
            try backend.translateSample(Self.sampleText)
            practiced = true
            notice = t("onboarding.practiceSeen")
        } catch {
            notice = SettingsRules.message(error)
        }
    }

    /// 无论有没有配好引擎都记下「走完了」——他可能就是想先看看客户端长什么样。界面负责说清后果。
    /// 先等最后一次保存落定（失败也照样结束：原因已经显示过了）。
    func finish() async {
        _ = await lastSave?.result
        do {
            _ = try await backend.applyPatch(["onboardingDone": .bool(true)])
            backend.close()
        } catch {
            notice = SettingsRules.message(error)
        }
    }
}
