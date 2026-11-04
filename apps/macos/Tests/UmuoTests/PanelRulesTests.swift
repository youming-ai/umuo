import Foundation
import Testing
import UmuoCore
@testable import Umuo

@Suite("快捷键触发的先后")
struct TriggerGateTests {
    @Test func 先按的键后取完_不再显示() {
        var gate = TriggerGate()
        let slow = gate.begin()
        let fast = gate.begin()
        #expect(gate.isCurrent(fast))
        #expect(!gate.isCurrent(slow))
    }

    @Test func 按Esc或换成别的内容后_没取完的按键作废() {
        var gate = TriggerGate()
        let pending = gate.begin()
        gate.invalidate()
        #expect(!gate.isCurrent(pending))
        let next = gate.begin()
        #expect(gate.isCurrent(next))
    }
}

@Suite("浮窗规则")
struct PanelRulesTests {
    private let screen = CGRect(x: 0, y: 0, width: 1440, height: 900)
    private let size = PanelRules.initialSize

    @Test func 放在鼠标右下方() {
        // AppKit 坐标原点在左下：屏幕坐标里「向下 18」就是 y 减 18
        let origin = PanelRules.topLeft(mouse: CGPoint(x: 400, y: 600), size: size, visible: screen)
        #expect(origin == CGPoint(x: 414, y: 582))
    }

    @Test func 右边放不下就贴着屏幕右边() {
        let origin = PanelRules.topLeft(mouse: CGPoint(x: 1300, y: 600), size: size, visible: screen)
        #expect(origin.x == screen.maxX - size.width)
    }

    @Test func 下面放不下就翻到光标上方() {
        let origin = PanelRules.topLeft(mouse: CGPoint(x: 400, y: 100), size: size, visible: screen)
        #expect(origin.y == 100 + 18 + size.height)
        // 浮窗整个在光标上方，不盖住光标所在的那行
        #expect(origin.y - size.height > 100)
    }

    @Test func 第二块屏幕上按那块屏幕收边() {
        let second = CGRect(x: 1440, y: 0, width: 1920, height: 1080)
        let origin = PanelRules.topLeft(mouse: CGPoint(x: 3350, y: 500), size: size, visible: second)
        #expect(origin.x == second.maxX - size.width)
        #expect(origin.x >= second.minX)
    }

    @Test func 界面语言跟设置走_读不到设置按系统() {
        #expect(AppLocale.resolve(settingsJson: #"{"theme":"light","locale":"ja"}"#, systemLanguages: ["en-US"]) == .ja)
        #expect(AppLocale.resolve(settingsJson: nil, systemLanguages: ["zh-Hant-TW"]) == .zhTW)
    }

    // 「替换原文」的 ⌘V 兜底前的那道检查（`check_panel_writable`，Rust 的同名测试逐条改写）。
    @Test func 只拒绝明确只读的文本控件() {
        // 终端 / 只读文本：能读选区，明确不可写 → 拒绝，免得 ⌘V 打进 shell
        #expect(throws: AXWriteBack.Refused.self) {
            try ReplaceSelection.checkPanelWritable(settable: false, selectionReadable: true)
        }
        #expect(throws: Never.self) { try ReplaceSelection.checkPanelWritable(settable: true, selectionReadable: true) }
        #expect(throws: Never.self) { try ReplaceSelection.checkPanelWritable(settable: nil, selectionReadable: true) }
        // Electron 等：读不出选区，它答的「不可写」不算数，留给 ⌘V 兜底
        for settable in [false, true, nil] as [Bool?] {
            #expect(throws: Never.self) {
                try ReplaceSelection.checkPanelWritable(settable: settable, selectionReadable: false)
            }
        }
    }

    @Test func 读得出选区时必须仍是原文_读不出时不核对() {
        #expect(throws: Never.self) { try ReplaceSelection.checkSelectionUnchanged(current: "Hello", original: "Hello") }
        // Electron / 网页视图（原文是 ⌘C 取到的）：没有可比对的，照旧交给 ⌘V
        #expect(throws: Never.self) { try ReplaceSelection.checkSelectionUnchanged(current: nil, original: "Hello") }
        for current in ["", "Hel", "Hello world"] {
            do {
                try ReplaceSelection.checkSelectionUnchanged(current: current, original: "Hello")
                Issue.record("选区塌成光标或换了内容，应当拒绝：\(current)")
            } catch {
                #expect(error.text.key == "error.selectionChanged")
            }
        }
    }

    @Test func 只读拒绝按界面语言给出原因() {
        do {
            try ReplaceSelection.checkPanelWritable(settable: false, selectionReadable: true)
            Issue.record("应当拒绝")
        } catch {
            #expect(Translate(locale: .zhCN)(error.text) == "当前位置不可写入：选中的内容是只读的")
            #expect(Translate(locale: .en)(error.text) == "Can't write here: the selected text is read-only")
        }
    }

    // 看门狗与替换原文的判据在 Rust（umuo_app::panel，测试在那边）；这里确认 FFI 导出的语义没走样。
    @Test func 看门狗_切走才收起_钉住与前台是自己都不收起() {
        let own = PanelController.ownToken
        #expect(shouldAutoHide(pinned: false, owner: "100", current: "200", own: own))
        #expect(!shouldAutoHide(pinned: true, owner: "100", current: "200", own: own))
        #expect(!shouldAutoHide(pinned: false, owner: "100", current: own, own: own))
        #expect(!shouldAutoHide(pinned: false, owner: own, current: "200", own: own))
        #expect(!shouldAutoHide(pinned: false, owner: "100", current: nil, own: own))
        #expect(!shouldAutoHide(pinned: false, owner: nil, current: "200", own: own))
    }

    @Test func 替换原文的计划与守卫() {
        let own = PanelController.ownToken
        #expect(planReplace(owner: own, current: "100", own: own) == .noSource)
        #expect(planReplace(owner: "100", current: own, own: own) == .refocus)
        #expect(planReplace(owner: "100", current: "100", own: own) == .write)
        // 不知道源应用：不管此刻前台是谁都不写回
        #expect(planReplace(owner: nil, current: "100", own: own) == .unknownSource)
        #expect(planReplace(owner: nil, current: nil, own: own) == .unknownSource)
        #expect(replaceTargetError(owner: nil, current: "100") != nil)
        #expect(PanelController.replaceSource("译文", original: "原文", owner: nil, t: Translate(locale: .en))
            == Translate(locale: .en)("panel.replaceUnknownSource"))
        #expect(noSourceMessage() == "这段文字不是从别的应用里取的，没有可替换的原文")
        #expect(replaceTargetError(owner: "100", current: "100") == nil)
        #expect(replaceTargetError(owner: "100", current: "200") == "目标应用已切换，已放弃替换原文")
        #expect(writeBackFailedMessage(detail: "x") == "写回原文失败：x")
    }

    @Test func 本应用的标识是进程号() {
        #expect(PanelController.ownToken == String(ProcessInfo.processInfo.processIdentifier))
    }
}
