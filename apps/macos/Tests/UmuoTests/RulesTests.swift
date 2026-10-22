import Testing
@testable import Umuo

// limits / scene-routing / hotkey-conflict / theme / onboarding 的 .test.ts 逐条改写。

private let t = Translate(locale: .zhCN)
private func limit(_ id: String, _ usd: Double) -> ProviderLimit { ProviderLimit(providerId: id, limitUsd: usd) }

@Suite("月度上限")
struct LimitsTests {
    @Test func 没设过的供应商返回nil而不是0() {
        #expect(Limits.limit([], for: "openai") == nil)
        #expect(Limits.limit([limit("deepseek", 5)], for: "openai") == nil)
    }

    @Test func 设过的能取回来() {
        #expect(Limits.limit([limit("openai", 5)], for: "openai") == 5)
    }

    @Test func 新增覆盖与清除() {
        #expect(Limits.set([], providerId: "openai", to: 5) == [limit("openai", 5)])
        let replaced = Limits.set([limit("openai", 5)], providerId: "openai", to: 9)
        #expect(replaced == [limit("openai", 9)])
        // 记成 0 会把「取消上限」变成「禁止花钱」，意思正好相反。
        #expect(Limits.set([limit("openai", 5)], providerId: "openai", to: nil) == [])
        #expect(Limits.set([], providerId: "openai", to: .nan) == [])
    }

    @Test func 零是有效的上限负数夹到零() {
        #expect(Limits.set([], providerId: "openai", to: 0) == [limit("openai", 0)])
        #expect(Limits.limit([limit("openai", 0)], for: "openai") == 0)
        #expect(Limits.set([], providerId: "openai", to: -3).first?.limitUsd == 0)
    }

    @Test func 解析输入框() {
        // Number('') 是 0，直接用它会让清空输入框变成「禁止花钱」。
        #expect(Limits.parse("") == nil)
        #expect(Limits.parse("  ") == nil)
        #expect(Limits.parse("abc") == nil)
        #expect(Limits.parse("5.5") == 5.5)
        #expect(Limits.parse("-2") == 0)
        // 与 parseFloat 同一口径：取开头的数字
        #expect(Limits.parse(" 5.5abc") == 5.5)
        #expect(Limits.parse(".5") == 0.5)
        #expect(Limits.parse("1e2") == 100)
    }

    @Test func 本月花费按供应商取() {
        #expect(Limits.spend([], for: "openai") == 0)
        #expect(Limits.spend([("openai", 1.5), ("deepseek", 9)], for: "openai") == 1.5)
    }

    @Test func 摘要() {
        #expect(Limits.summary(limit: nil, spentUsd: 1.2345, t).contains("不限"))
        #expect(Limits.summary(limit: 5, spentUsd: 6.5, t).contains("已超限"))
        // 正好花到上限也算超限（与 Rust 侧 >= 的口径一致）
        #expect(Limits.summary(limit: 5, spentUsd: 5, t).contains("已超限"))
        #expect(!Limits.summary(limit: 5, spentUsd: 1, t).contains("已超限"))
    }
}

private func ref(_ provider: String, _ model: String) -> ModelRef { ModelRef(providerId: provider, model: model) }

@Suite("分场景模型与备用顺序")
struct SceneRoutingTests {
    @Test func 覆盖PRD点名的场景且不含对比() {
        #expect(SceneRouting.rows.map(\.rawValue) == ["selection", "compose", "silentReplace", "ocr", "wordCard"])
    }

    @Test func 供应商与模型都填了才算配好() {
        #expect(ref("openai", "gpt-4o").isComplete)
        #expect(!ref("openai", "").isComplete)
        #expect(!ref("", "gpt-4o").isComplete)
        #expect(!ref("openai", "   ").isComplete)
    }

    @Test func 没配时显示用默认模型而不是空白() {
        #expect(SceneRouting.label(nil, t) == "用默认模型")
        #expect(SceneRouting.label(ref("", ""), t) == "用默认模型")
        #expect(SceneRouting.label(ref("openai", "gpt-4o"), t) == "openai · gpt-4o")
        // 文案随界面语言走（审查 L24）
        #expect(SceneRouting.label(nil, Translate(locale: .en)) == "Use the default model")
    }

    @Test func 设置场景模型() {
        let empty = SceneModels()
        let next = SceneRouting.set(empty, .silentReplace, to: ref("deepseek", "deepseek-chat"))
        #expect(next.scenes[.silentReplace] == ref("deepseek", "deepseek-chat"))
        #expect(next.scenes[.selection] == nil)
        // 只填供应商不算配好，会退回默认
        #expect(SceneRouting.set(empty, .ocr, to: ref("openai", "")).scenes[.ocr] == nil)
        let configured = SceneRouting.set(empty, .compose, to: ref("anthropic", "claude-sonnet-4-5"))
        #expect(SceneRouting.set(configured, .compose, to: nil).scenes[.compose] == nil)
    }

    @Test func 备用顺序() {
        var list: [ModelRef] = []
        list = SceneRouting.addFallback(list, ref("deepseek", "deepseek-chat"))
        list = SceneRouting.addFallback(list, ref("anthropic", "claude-sonnet-4-5"))
        #expect(list.map(\.providerId) == ["deepseek", "anthropic"])
        // 重复的一对不会被加两次；同一个供应商的不同模型算两条；没填完的不进列表
        #expect(SceneRouting.addFallback(list, ref("deepseek", "deepseek-chat")).count == 2)
        #expect(SceneRouting.addFallback(list, ref("deepseek", "deepseek-reasoner")).count == 3)
        #expect(SceneRouting.addFallback([], ref("openai", "")) == [])
        #expect(SceneRouting.removeFallback([ref("a", "1"), ref("b", "2")], at: 0).map(\.providerId) == ["b"])
    }

    @Test func 可以上下移动越界是无操作() {
        let list = [ref("a", "1"), ref("b", "2"), ref("c", "3")]
        #expect(SceneRouting.moveFallback(list, at: 2, by: -1).map(\.providerId) == ["a", "c", "b"])
        #expect(SceneRouting.moveFallback(list, at: 0, by: 1).map(\.providerId) == ["b", "a", "c"])
        let two = [ref("a", "1"), ref("b", "2")]
        #expect(SceneRouting.moveFallback(two, at: 0, by: -1) == two)
        #expect(SceneRouting.moveFallback(two, at: 1, by: 1) == two)
        #expect(SceneRouting.moveFallback(two, at: 9, by: 1) == two)
    }
}

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
        // 新增默认快捷键时如果撞了系统键或彼此重复，这里会亮。七个默认值取自 HotkeyCenter.table。
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

@Suite("主题解析（PRD §7.3）")
struct ThemeTests {
    @Test func 明选的主题不理会系统偏好() {
        #expect(ThemeChoice.resolve("light", prefersDark: true) == .light)
        #expect(ThemeChoice.resolve("dark", prefersDark: false) == .dark)
    }

    @Test func 跟随系统时按系统偏好走() {
        #expect(ThemeChoice.resolve("system", prefersDark: true) == .dark)
        #expect(ThemeChoice.resolve("system", prefersDark: false) == .light)
        #expect(ThemeChoice.followsSystem("system"))
        #expect(!ThemeChoice.followsSystem("dark"))
    }

    @Test func 高对比度() {
        #expect(ThemeChoice.resolve("highContrast", prefersDark: true) == .highContrast)
        #expect(ThemeChoice.resolve("highContrast", prefersDark: false) == .highContrast)
    }

    @Test func 认不出来的值回落跟随系统() {
        #expect(ThemeChoice.resolve("", prefersDark: true) == .dark)
        #expect(ThemeChoice.resolve("nonsense", prefersDark: false) == .light)
        #expect(ThemeChoice.resolve(nil, prefersDark: true) == .dark)
        #expect(ThemeChoice.followsSystem("nonsense"))
    }

    @Test func 选项覆盖三种外加高对比度且每个都有文案() {
        #expect(ThemeChoice.allCases.map(\.rawValue) == ["system", "light", "dark", "highContrast"])
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
