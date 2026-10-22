import Testing
import UmuoCore
@testable import Umuo

@Suite("应用外壳")
@MainActor
struct AppShellTests {
    @Test func 只有正式客户端才注册全局快捷键() {
        let production = bundleId()
        // `.build/debug/Umuo` 没有 Info.plist：开发期与 Tauri 版同开时不抢快捷键
        #expect(!HotkeyPolicy.shouldRegister(arguments: [], bundleIdentifier: nil, productionBundleId: production))
        #expect(!HotkeyPolicy.shouldRegister(arguments: [], bundleIdentifier: "com.example.other", productionBundleId: production))
        #expect(HotkeyPolicy.shouldRegister(arguments: [], bundleIdentifier: production, productionBundleId: production))
        #expect(HotkeyPolicy.shouldRegister(arguments: ["--hotkeys"], bundleIdentifier: nil, productionBundleId: production))
        #expect(!HotkeyPolicy.shouldRegister(arguments: ["--no-hotkeys"], bundleIdentifier: production,
                                             productionBundleId: production))
        #expect(!HotkeyPolicy.shouldRegister(arguments: ["--hotkeys", "--no-hotkeys"], bundleIdentifier: nil,
                                             productionBundleId: production))
    }

    @Test func 七个功能各自分发到接上的处理函数() {
        let router = ActionRouter()
        var hits: [HotkeyAction] = []
        for action in HotkeyAction.allCases where action != .speak {
            router.handle(action) { hits.append(action) }
        }
        for action in HotkeyAction.allCases { router.perform(action) }
        #expect(hits == HotkeyAction.allCases.filter { $0 != .speak })
        // 还没接上的功能不崩，只报告没人接
        #expect(!router.perform(.speak))
        #expect(router.handled.count == 6)
    }

    @Test func 测试进程里的AppModel不注册快捷键() {
        // swift test 的进程不是正式客户端：AppModel 默认就不该去抢用户的快捷键
        let model = AppModel(arguments: [], bundleIdentifier: nil)
        #expect(!model.registersHotkeys)
        #expect(model.hotkeys.registeredCombos == 0)
        model.settingsApplied(settingsJson: #"{"selectionHotkey":"Alt+D"}"#, hotkeysChanged: true)
        #expect(model.hotkeys.registeredCombos == 0)
    }

    @Test func 设置JSON只取视图要的字段() {
        let object = JSONValue.object(json: #"{"theme":"dark","futureField":{"a":[1,true,null]}}"#)
        #expect(object?["theme"]?.stringValue == "dark")
        #expect(object.map(JSONValue.json).flatMap(JSONValue.object(json:)) == object)
        #expect(JSONValue.object(json: "[1]") == nil)
    }
}
