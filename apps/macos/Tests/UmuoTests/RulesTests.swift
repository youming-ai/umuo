import AppKit
import Testing
@testable import Umuo

// hotkey-conflict / theme / onboarding 的 .test.ts 逐条改写。

private let t = Translate(locale: .zhCN)

@Suite("快捷键冲突")
struct HotkeyConflictTests {
    @Test func 修饰键别名与顺序不影响判定() {
        #expect(HotkeyConflict.normalize("Option+D") == "alt+d")
        #expect(HotkeyConflict.normalize("alt+d") == "alt+d")
        #expect(HotkeyConflict.normalize("Command+Shift+T") == "shift+cmd+t")
        #expect(HotkeyConflict.normalize("Shift+Cmd+T") == "shift+cmd+t")
        #expect(HotkeyConflict.normalize("  Option + D  ") == "alt+d")
        #expect(HotkeyConflict.normalize("ALT+SHIFT+C") == HotkeyConflict.normalize("alt + shift + c"))
        #expect(HotkeyConflict.normalize("") == "")
        #expect(HotkeyConflict.normalize("   ") == "")
    }

    @Test func Alt与Option写法不同也认作同一个修饰键() {
        // Tauri 版的别名表漏了 `alt`，`Alt+Shift+T` 与 `Option+Shift+T` 归一化后不相等；这里补上了。
        #expect(HotkeyConflict.normalize("Alt+Shift+T") == HotkeyConflict.normalize("Option+Shift+T"))
    }

    private let others = [(label: "划词翻译", value: "Alt+D"), (label: "截图 OCR", value: "Alt+S")]

    @Test func 干净的组合与留空都没有冲突() {
        #expect(HotkeyConflict.check("Alt+R", others: others) == nil)
        #expect(HotkeyConflict.check("Cmd+Shift+J", others: others) == nil)
        #expect(HotkeyConflict.check("", others: others) == nil)
    }

    @Test func 与自己其它功能重复会被认出来且别名无关() {
        let conflict = HotkeyConflict.check("Option+D", others: others)
        #expect(conflict?.kind == .duplicate)
        #expect(conflict?.message.contains("划词翻译") == true)
    }

    @Test func 没有真正的修饰键会被拦下() {
        #expect(HotkeyConflict.check("D", others: others)?.kind == .noModifier)
        #expect(HotkeyConflict.check("Shift+D", others: others)?.kind == .noModifier)
    }

    @Test func 命中已知系统快捷键会说明那个功能是谁的() {
        let spotlight = HotkeyConflict.check("Cmd+Space", others: others)
        #expect(spotlight?.kind == .system)
        #expect(spotlight?.message.contains("Spotlight") == true)
        #expect(HotkeyConflict.check("Cmd+Shift+4", others: others)?.message.contains("截取") == true)
    }

    @Test func 客户端自带的默认快捷键全部通过检查() {
        // 新增默认快捷键时如果撞了系统键或彼此重复，这里会亮。当前默认值取自 HotkeyCenter.table。
        let defaults = HotkeyCenter.table.map(\.fallback)
        for candidate in defaults {
            let rest = defaults.filter { $0 != candidate }.map { (label: $0, value: $0) }
            #expect(HotkeyConflict.check(candidate, others: rest) == nil, "\(candidate) 不该有冲突")
        }
    }

    @Test func 连按本身只有修饰键不报缺修饰键() {
        #expect(HotkeyConflict.check("Ctrl Ctrl", others: []) == nil)
    }

    @Test func 与别的功能的连按重叠时报重复() {
        #expect(HotkeyConflict.check("Ctrl Ctrl", others: [(label: "划词翻译", value: "RightCtrl RightCtrl")])
            == .init(kind: .duplicate, message: "与「划词翻译」重复", subject: "划词翻译"))
        #expect(HotkeyConflict.check("Alt Alt", others: [(label: "划词翻译", value: "Ctrl Ctrl")]) == nil)
    }
}

@Suite("外观（PRD §7.3）")
struct ThemeTests {
    @Test func 明选浅色深色_其余跟随系统() {
        #expect(ThemeChoice.appearanceName("light") == .aqua)
        #expect(ThemeChoice.appearanceName("dark") == .darkAqua)
        #expect(ThemeChoice.appearanceName("system") == nil)
    }

    @Test func 旧的高对比度与认不出来的值都跟随系统() {
        // 高对比度交给系统的「增强对比度」，不再有一套自己的配色
        for value in ["highContrast", "", "nonsense", nil] as [String?] {
            #expect(ThemeChoice.appearanceName(value) == nil)
        }
    }

    @Test func 选项只有三种且每个都有文案() {
        #expect(ThemeChoice.allCases.map(\.rawValue) == ["system", "light", "dark"])
        let en = Translate(locale: .en)
        for choice in ThemeChoice.allCases { #expect(en(choice.titleKey) != choice.titleKey) }
    }
}

private let fresh = OnboardingState()

@Suite("首次引导")
struct OnboardingTests {
    @Test func 五步与PRD一一对应() {
        #expect(OnboardingStep.allCases.map(\.rawValue) == ["welcome", "languages", "model", "permissions", "practice"])
    }

    @Test func 每一步的标题都走文案表() {
        let en = Translate(locale: .en)
        for step in OnboardingStep.allCases { #expect(en(step.titleKey) != step.titleKey) }
        #expect(en(OnboardingStep.welcome.titleKey) == "Welcome")
    }

    @Test func 前后步骤() {
        #expect(OnboardingStep.welcome.previous == nil)
        #expect(OnboardingStep.practice.next == nil)
        #expect(OnboardingStep.welcome.next == .languages)
        #expect(OnboardingStep.permissions.previous == .model)
        #expect(OnboardingStep.practice.index == 4)
    }

    @Test func 完成度() {
        #expect(OnboardingStep.welcome.isSatisfied(fresh))
        #expect(fresh.progress == (1, 5))
        var state = fresh
        state.targetLang = "zh-CN"
        #expect(OnboardingStep.languages.isSatisfied(state))
        state.targetLang = "   "
        #expect(!OnboardingStep.languages.isSatisfied(state))
        #expect(!OnboardingStep.model.isSatisfied(fresh))
        #expect(OnboardingStep.model.isSatisfied(OnboardingState(keyConfigured: true)))
        #expect(OnboardingStep.model.isSatisfied(OnboardingState(localModelFound: true)))
        // 屏幕录制只影响截图；因为用户暂时不想授权就卡住引导，是本末倒置。
        #expect(!OnboardingStep.permissions.isSatisfied(OnboardingState(screenRecordingGranted: true)))
        #expect(OnboardingStep.permissions.isSatisfied(OnboardingState(accessibilityTrusted: true)))
        #expect(OnboardingStep.practice.isSatisfied(OnboardingState(practiced: true)))
        let done = OnboardingState(targetLang: "zh-CN", keyConfigured: true, accessibilityTrusted: true,
                                   screenRecordingGranted: true, practiced: true)
        #expect(done.progress == (5, 5))
    }

    @Test func 有没有能用的引擎() {
        #expect(!fresh.hasUsableEngine)
        #expect(OnboardingState(keyConfigured: true).hasUsableEngine)
        #expect(OnboardingState(localModelFound: true).hasUsableEngine)
    }

    @Test func 引导写进设置的默认引擎() {
        #expect(Onboarding.engineForSavedKey(providerId: "anthropic", defaultModel: "claude-3-5-haiku-latest")
            == EngineChoice(providerId: "anthropic", model: "claude-3-5-haiku-latest"))
        #expect(Onboarding.engineForLocalModel("qwen2.5:7b", keyConfigured: false, requiresKey: true)
            == EngineChoice(providerId: "ollama", model: "qwen2.5:7b"))
        #expect(Onboarding.engineForLocalModel("qwen2.5:7b", keyConfigured: true, requiresKey: true) == nil)
        // 首选已是本机供应商时不覆盖用户挑的模型
        #expect(Onboarding.engineForLocalModel("qwen2.5:7b", keyConfigured: false, requiresKey: false) == nil)
    }
}
