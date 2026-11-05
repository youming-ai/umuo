import Testing
import UmuoCore
@testable import Umuo

@Suite("应用外壳")
@MainActor
struct AppShellTests {
    @Test func 只有正式客户端才注册全局快捷键() {
        let production = bundleId()
        // `.build/debug/Umuo` 没有 Info.plist：开发构建与正式安装版同开时不抢快捷键
        #expect(!HotkeyPolicy.shouldRegister(arguments: [], bundleIdentifier: nil, productionBundleId: production))
        #expect(!HotkeyPolicy.shouldRegister(arguments: [], bundleIdentifier: "com.example.other", productionBundleId: production))
        #expect(HotkeyPolicy.shouldRegister(arguments: [], bundleIdentifier: production, productionBundleId: production))
        #expect(HotkeyPolicy.shouldRegister(arguments: ["--hotkeys"], bundleIdentifier: nil, productionBundleId: production))
        #expect(!HotkeyPolicy.shouldRegister(arguments: ["--no-hotkeys"], bundleIdentifier: production,
                                             productionBundleId: production))
        #expect(!HotkeyPolicy.shouldRegister(arguments: ["--hotkeys", "--no-hotkeys"], bundleIdentifier: nil,
                                             productionBundleId: production))
    }

    @Test func 窗口还没建时核心功能与打开窗口都不崩() {
        // swift test 里的 AppModel 不调 start()：浮窗、撰写窗等都没建，快捷键与菜单进来只是什么都不做
        let model = AppModel(arguments: [], bundleIdentifier: nil)
        for action in HotkeyAction.allCases { model.perform(action) }
        model.openSettings()
        model.openHistory()
        model.openOnboarding()
        model.openCompose(ComposePrefill(text: "x", translation: nil, sourceOwner: nil))
        #expect(model.panel == nil && model.compose == nil)
    }

    @Test func 内核未就绪的提示按界面语言取() {
        let model = AppModel(arguments: [], bundleIdentifier: nil)
        #expect(model.engineStatus == model.t("app.engineStarting"))
        #expect(StringCatalog.main.entries["app.engineStarting"]?.values.count == 4)
    }

    @Test func 测试进程里的AppModel不注册快捷键() {
        // swift test 的进程不是正式客户端：AppModel 默认就不该去抢用户的快捷键
        let model = AppModel(arguments: [], bundleIdentifier: nil)
        #expect(!model.registersHotkeys)
        #expect(model.hotkeys.registeredCombos == 0)
        model.settingsApplied(settingsJson: #"{"selectionHotkey":"Alt+D"}"#, hotkeysChanged: true)
        #expect(model.hotkeys.registeredCombos == 0)
    }

    @Test func 内核打不开也照样注册快捷键_按下时由各入口说明内核状态() {
        struct OpenFailed: Error, CustomStringConvertible { var description: String { "TLS 初始化失败" } }
        for result in [Result<Engine, Error>.failure(OpenFailed()), nil] {
            let model = AppModel(arguments: [], bundleIdentifier: nil)
            var registered: [[String: String]] = []
            model.registerHotkeys = { registered.append($0) }
            model.opened(result, settingsJson: nil)
            // 读不到设置：按各行的回落组合键注册（空值 = 全部回落）
            #expect(registered == [[:]])
            #expect(model.engine == nil)
            #expect(model.engineStatus != model.t("app.engineStarting"))
        }
    }

    @Test func 旧退役键位不进入全局注册计划() {
        let values = HotkeyCenter.values(settingsJson: #"{"selectionHotkey":"Ctrl Ctrl","silentReplaceHotkey":"Alt Alt","composeHotkey":"Alt+Cmd+A","ocrHotkey":"Alt+Cmd+O","compareHotkey":"Alt+Cmd+O","ocrSilentHotkey":"Ctrl Ctrl","speakHotkey":"Alt Alt"}"#)
        let plan = HotkeyCenter.plan(values)
        #expect(plan.map(\.action) == [.selection, .silentReplace, .compose, .ocr])
        #expect(values["compareHotkey"] == nil)
        #expect(values["ocrSilentHotkey"] == nil)
        #expect(values["speakHotkey"] == nil)
    }

    @Test func 设置JSON只取视图要的字段() {
        let object = JSONValue.object(json: #"{"theme":"dark","futureField":{"a":[1,true,null]}}"#)
        #expect(object?["theme"]?.stringValue == "dark")
        #expect(object.map(JSONValue.json).flatMap(JSONValue.object(json:)) == object)
        #expect(JSONValue.object(json: "[1]") == nil)
    }
}
