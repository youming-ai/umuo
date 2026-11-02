import AppKit
import Foundation
import os
import Testing
import UmuoCore
@testable import Umuo

// 语音结果交付到输入框（阶段 E）。
// 假 AX（FakeProbe）、假剪贴板（FakePasteboard）、假的 ⌘V：不碰真实辅助功能、不动用户剪贴板、不往别的应用里按键。

/// 假的焦点探针：交付前「现查」到什么由测试设定；记录写了什么、按了几次 ⌘V。
private final class FakeProbe: VoiceFocusProbing, @unchecked Sendable {
    private let lock = NSLock()
    private var _check = VoiceDeliveryCheck()
    private var _inserted: [String] = []
    private var _targets: [AXUIElement] = []
    private var _captures = 0
    var insertSucceeds = true
    var frontmost: pid_t? = 42

    var checkResult: VoiceDeliveryCheck {
        get { lock.withLock { _check } }
        set { lock.withLock { _check = newValue } }
    }

    var inserted: [String] { lock.withLock { _inserted } }
    /// 每次 AX 写入写的是哪个元素。
    var insertedInto: [AXUIElement] { lock.withLock { _targets } }
    var captures: Int { lock.withLock { _captures } }

    func capture() -> VoiceTarget {
        lock.withLock { _captures += 1 }
        return target
    }

    func check(_: VoiceTarget) -> VoiceDeliveryCheck { checkResult }

    func insert(_ text: String, into element: AXUIElement) -> Bool {
        lock.withLock {
            _inserted.append(text)
            _targets.append(element)
            return insertSucceeds
        }
    }

    func frontmostPid() -> pid_t? { lock.withLock { frontmost } }
}

/// 假剪贴板 + 记下 ⌘V 次数的假粘贴。
private final class PasteRig: @unchecked Sendable {
    let pasteboard = FakePasteboard()
    private let count = OSAllocatedUnfairLock(initialState: 0)
    /// 按 ⌘V 时剪贴板上是什么（目标应用会读到的内容）。
    private let seen = OSAllocatedUnfairLock<[String]>(initialState: [])
    /// 设了就在 ⌘V 之后模拟「用户中途复制了别的」。
    var userCopiesAfterPaste: String?
    var pasteFails = false

    var pastes: Int { count.withLock { $0 } }
    var pastedTexts: [String] { seen.withLock { $0 } }

    func paster() -> ControlledPaste {
        ControlledPaste(pasteboard: pasteboard, paste: { () throws(SelectionError) in
            if self.pasteFails { throw SelectionError.other(UserText("error.keyEventFailed")) }
            self.count.withLock { $0 += 1 }
            let current = self.pasteboard.string(forType: .string) ?? ""
            self.seen.withLock { $0.append(current) }
            if let copied = self.userCopiesAfterPaste {
                self.pasteboard.clearContents()
                self.pasteboard.setString(copied, forType: .string)
            }
        }, restoreDelay: 0)
    }
}

/// 录音开始时记下的目标。元素用应用级 AX 对象代替（创建它不需要辅助功能权限，也不会去问别的进程）。
private let target = VoiceTarget(pid: 42, element: AXUIElementCreateApplication(42), window: nil)

private func perform(_ probe: FakeProbe, _ rig: PasteRig, cancelled: Bool = false) -> VoiceDeliveryRefusal? {
    FocusedFieldDelivery.perform("后天见。", target: target, probe: probe, paster: rig.paster()) { cancelled }
}

struct VoiceDeliveryRulesTests {
    @Test func 核验全部通过_可写走AX_问不出来走粘贴_只读拒绝() {
        var check = VoiceDeliveryCheck()
        check.settable = true
        #expect(VoiceDeliveryRules.route(check) == .accessibility)
        check.settable = nil
        #expect(VoiceDeliveryRules.route(check) == .paste)
        check.settable = false
        #expect(VoiceDeliveryRules.route(check) == .refuse(.notEditable), "终端这类读得出选区却明确只读的不粘")
    }

    @Test func 读不出选区时可写性不算数_明显不是文本输入的不粘() {
        var check = VoiceDeliveryCheck()
        check.selectionReadable = false
        check.settable = false
        check.role = "AXGroup"
        #expect(VoiceDeliveryRules.route(check) == .paste, "Electron 的 group 对任何属性都答不可写")
        check.role = "AXOutline"
        #expect(VoiceDeliveryRules.route(check) == .refuse(.notEditable), "访达列表里 ⌘V 会粘贴文件")
    }

    @Test func 每一项核验不通过都拒绝且原因对应() {
        let cases: [(WritableKeyPath<VoiceDeliveryCheck, Bool>, Bool, VoiceDeliveryRefusal)] = [
            (\.trusted, false, .noPermission),
            (\.captured, false, .unverifiable),
            (\.targetAlive, false, .targetGone),
            (\.sameApp, false, .appChanged),
            (\.sameElement, false, .focusChanged),
            (\.secureInput, true, .secureInput),
        ]
        for (path, value, reason) in cases {
            var check = VoiceDeliveryCheck()
            check.settable = true
            check[keyPath: path] = value
            #expect(VoiceDeliveryRules.route(check) == .refuse(reason), "\(path)")
        }
    }

    @Test func 每种拒绝原因都有四语言文案() {
        let reasons: [VoiceDeliveryRefusal] = [.appChanged, .focusChanged, .notEditable, .secureInput, .targetGone,
                                               .unverifiable, .noPermission, .failed]
        for reason in reasons {
            #expect(StringCatalog.main.entries[VoiceOverlayView.refusalKey(reason)]?.values.count == 4, "\(reason)")
        }
    }

    @Test func 安全输入优先于可写性_密码框可写也不写() {
        var check = VoiceDeliveryCheck()
        check.settable = true
        check.secureInput = true
        check.role = "AXSecureTextField"
        #expect(VoiceDeliveryRules.route(check) == .refuse(.secureInput))
    }
}

struct ControlledPasteTests {
    @Test func 粘贴后剪贴板原样恢复_包括非文本内容() {
        let rig = PasteRig()
        rig.pasteboard.writeItems([[
            .init(type: NSPasteboard.PasteboardType.string.rawValue, data: Data("用户原来复制的".utf8)),
            .init(type: "com.example.custom", data: Data([1, 2, 3])),
        ]])
        let before = Pasteboard.Snapshot.take(rig.pasteboard)

        let outcome = rig.paster().run("后天见。") { true }
        #expect(outcome == .pasted(restored: true))
        #expect(rig.pastedTexts == ["后天见。"], "⌘V 时剪贴板上是语音结果")
        #expect(Pasteboard.Snapshot.take(rig.pasteboard) == before)
    }

    @Test func 期间用户复制了别的就不恢复覆盖() {
        let rig = PasteRig()
        rig.pasteboard.clearContents()
        rig.pasteboard.setString("旧的", forType: .string)
        rig.userCopiesAfterPaste = "用户刚复制的"
        let outcome = rig.paster().run("后天见。") { true }
        #expect(outcome == .pasted(restored: false))
        #expect(rig.pasteboard.string(forType: .string) == "用户刚复制的")
    }

    @Test func 最后一道检查不过就不按键并立即恢复() {
        let rig = PasteRig()
        rig.pasteboard.clearContents()
        rig.pasteboard.setString("旧的", forType: .string)
        let outcome = rig.paster().run("后天见。") { false }
        #expect(outcome == .skipped)
        #expect(rig.pastes == 0)
        #expect(rig.pasteboard.string(forType: .string) == "旧的")
    }

    @Test func 按键失败如实上报并恢复() {
        let rig = PasteRig()
        rig.pasteboard.clearContents()
        rig.pasteboard.setString("旧的", forType: .string)
        rig.pasteFails = true
        #expect(rig.paster().run("后天见。") { true } == .failed(UserText("error.keyEventFailed")))
        #expect(rig.pasteboard.string(forType: .string) == "旧的")
    }

    @Test func 原来是空的剪贴板粘完还是空的() {
        let rig = PasteRig()
        rig.pasteboard.clearContents()
        #expect(rig.paster().run("后天见。") { true } == .pasted(restored: true))
        #expect(rig.pasteboard.isEmpty)
    }
}

struct FocusedFieldDeliveryTests {
    @Test func 可写的原输入框_经AX插入_不碰剪贴板() {
        let probe = FakeProbe()
        probe.checkResult.settable = true
        let rig = PasteRig()
        #expect(perform(probe, rig) == nil)
        #expect(probe.inserted == ["后天见。"])
        #expect(rig.pastes == 0)
    }

    @Test func AX写入的是核验过的那个元素_不重新取焦点() {
        // 核验（check）比对的是录音开始时记下的元素；写入时再取一次焦点，中间换了框就会写到没核验过的地方。
        let probe = FakeProbe()
        probe.checkResult.settable = true
        #expect(perform(probe, PasteRig()) == nil)
        #expect(probe.insertedInto.count == 1)
        #expect(probe.insertedInto.first.map { CFEqual($0, target.element!) } == true)
    }

    @Test func AX问不出来时受控粘贴() {
        let probe = FakeProbe()
        probe.checkResult.settable = nil
        let rig = PasteRig()
        rig.pasteboard.clearContents()
        rig.pasteboard.setString("旧的", forType: .string)
        #expect(perform(probe, rig) == nil)
        #expect(probe.inserted.isEmpty)
        #expect(rig.pastedTexts == ["后天见。"])
        #expect(rig.pasteboard.string(forType: .string) == "旧的")
    }

    @Test func AX声称可写却拒绝时退回粘贴() {
        let probe = FakeProbe()
        probe.checkResult.settable = true
        probe.insertSucceeds = false
        let rig = PasteRig()
        #expect(perform(probe, rig) == nil)
        #expect(rig.pastes == 1)
    }

    @Test func 核验不通过的各分支都不写也不按键() {
        let failing: [(String, (inout VoiceDeliveryCheck) -> Void, VoiceDeliveryRefusal)] = [
            ("切应用", { $0.sameApp = false }, .appChanged),
            ("同应用换框", { $0.sameElement = false }, .focusChanged),
            ("只读", { $0.settable = false }, .notEditable),
            ("安全输入", { $0.secureInput = true }, .secureInput),
            ("目标退出", { $0.targetAlive = false }, .targetGone),
            ("无法核验", { $0.captured = false }, .unverifiable),
            ("没有权限", { $0.trusted = false }, .noPermission),
        ]
        for (name, change, reason) in failing {
            let probe = FakeProbe()
            probe.checkResult.settable = true
            change(&probe.checkResult)
            let rig = PasteRig()
            #expect(perform(probe, rig) == reason, "\(name)")
            #expect(probe.inserted.isEmpty, "\(name)")
            #expect(rig.pastes == 0, "\(name)")
        }
    }

    @Test func 取消后不交付() {
        let probe = FakeProbe()
        probe.checkResult.settable = true
        let rig = PasteRig()
        #expect(perform(probe, rig, cancelled: true) == .failed)
        #expect(probe.inserted.isEmpty)
        #expect(rig.pastes == 0)
    }

    @Test func 粘贴前前台换了就不按键() {
        let probe = FakeProbe()
        probe.checkResult.settable = nil
        probe.frontmost = 7
        let rig = PasteRig()
        rig.pasteboard.clearContents()
        rig.pasteboard.setString("旧的", forType: .string)
        #expect(perform(probe, rig) == .appChanged)
        #expect(rig.pastes == 0)
        #expect(rig.pasteboard.string(forType: .string) == "旧的")
    }

    @Test @MainActor func 没记目标的会话不交付_取消的会话不交付() async {
        let probe = FakeProbe()
        probe.checkResult.settable = true
        let delivery = FocusedFieldDelivery(probe: probe, paster: PasteRig().paster())
        #expect(await delivery.deliver(session: 1, text: "x") == .unverifiable, "没在录音开始时记目标")
        delivery.capture(session: 2)
        delivery.cancel(session: 2)
        #expect(await delivery.deliver(session: 2, text: "x") != nil)
        #expect(probe.inserted.isEmpty)
        // 新会话的目标顶掉旧的：旧会话迟到的交付找不到目标
        delivery.capture(session: 3)
        delivery.capture(session: 4)
        #expect(await delivery.deliver(session: 3, text: "迟到") == .unverifiable)
        #expect(await delivery.deliver(session: 4, text: "这一句") == nil)
        #expect(probe.inserted == ["这一句"])
    }
}
