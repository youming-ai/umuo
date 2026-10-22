import Foundation

/// 首次启动引导的步骤与完成度（PRD §7.4，五步），`onboarding.ts` 的移植。
///
/// 只有「顺序」与「这一步算不算完成」是逻辑。**引导不阻止用户前进**：权限可以稍后授予、模型可以稍后再配，
/// 把人卡在第四步只会让他卸载，而不是让他去系统设置里点一下。
enum OnboardingStep: String, CaseIterable, Sendable {
    case welcome, languages, model, permissions, practice

    /// 标题在文案表里（审查 L24：写死中文的话，其它界面语言的用户也只能看到中文）。
    var titleKey: String { "onboarding.step.\(rawValue)" }

    var index: Int { Self.allCases.firstIndex(of: self)! }
    var next: OnboardingStep? { index + 1 < Self.allCases.count ? Self.allCases[index + 1] : nil }
    var previous: OnboardingStep? { index > 0 ? Self.allCases[index - 1] : nil }

    /// 这一步是否已经做完。只用于**显示进度与提示**，不用于阻止前进。
    func isSatisfied(_ state: OnboardingState) -> Bool {
        switch self {
        case .welcome: true
        case .languages: !state.targetLang.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .model: state.hasUsableEngine
        // 辅助功能是取词的必需项；屏幕录制只影响截图，不阻塞这一步的完成。
        case .permissions: state.accessibilityTrusted
        case .practice: state.practiced
        }
    }
}

struct OnboardingState: Equatable, Sendable {
    /// 第一目标语言。
    var targetLang = ""
    /// 至少配了一把 Key。
    var keyConfigured = false
    /// 探测到本机可用的 Ollama / LM Studio 模型。
    var localModelFound = false
    var accessibilityTrusted = false
    var screenRecordingGranted = false
    /// 在引导里真的翻过一次。
    var practiced = false

    /// 进度：做完了几步 / 一共几步。欢迎页天然算完成，进度不从 0/5 开始。
    var progress: (done: Int, total: Int) {
        (OnboardingStep.allCases.filter { $0.isSatisfied(self) }.count, OnboardingStep.allCases.count)
    }

    /// 有没有一个「这次真能用」的引擎。都没有时引导**仍然可以结束**，但要说清后果。
    var hasUsableEngine: Bool { keyConfigured || localModelFound }
}

/// 引导要写进设置的默认引擎（`providerId` + `model`）。
struct EngineChoice: Equatable, Sendable {
    var providerId: String
    var model: String
}

enum Onboarding {
    /// 在引导里保存 Key 之后：首选换成这家，模型用它的默认模型（审查 H6：只存 Key 不改首选的话，
    /// 第一次划词仍走出厂的 OpenAI，报「缺少 Key」；沿用上一家的模型名会 404）。
    static func engineForSavedKey(providerId: String, defaultModel: String?) -> EngineChoice {
        EngineChoice(providerId: providerId, model: defaultModel ?? "")
    }

    /// 探测到本机模型后的默认引擎；nil 表示不改。首选已经能用时不抢：有 Key 的云端引擎是用户刚配好的；
    /// 首选本来就是本机供应商（`requiresKey == false`）时，他自己挑的模型不能被探测到的第一个覆盖。
    ///
    /// `providerId` 是探测到模型的那一家（Ollama 或 LM Studio，见 `pickLocal`）。
    static func engineForLocalModel(_ model: String, providerId: String = "ollama", keyConfigured: Bool,
                                    requiresKey: Bool) -> EngineChoice?
    {
        keyConfigured || !requiresKey ? nil : EngineChoice(providerId: providerId, model: model)
    }

    /// 探测本机模型的顺序：先 Ollama 再 LM Studio（与断网回落本机模型时的顺序一致）。
    static let localProviders = ["ollama", "lmstudio"]

    /// 对一家本机供应商拉模型列表的结果。
    enum LocalProbe: Equatable, Sendable {
        /// 服务在跑，这是它报出来的模型（可能为空）。
        case models([String])
        /// 连不上（没启动、端口不对）。
        case unreachable
    }

    /// 一个都没挑出来的原因：服务在跑但没有模型，与压根没检测到服务，给用户的下一步不一样。
    enum LocalMiss: Error, Equatable, Sendable {
        case noModels
        case missing
    }

    /// 按 `localProviders` 的顺序挑第一家有模型的，取它报出来的第一个模型。
    static func pickLocal(_ probes: [(providerId: String, probe: LocalProbe)]) -> Result<EngineChoice, LocalMiss> {
        var sawRunning = false
        for (providerId, probe) in probes {
            guard case let .models(models) = probe else { continue }
            sawRunning = true
            if let first = models.first { return .success(EngineChoice(providerId: providerId, model: first)) }
        }
        return .failure(sawRunning ? .noModels : .missing)
    }
}
