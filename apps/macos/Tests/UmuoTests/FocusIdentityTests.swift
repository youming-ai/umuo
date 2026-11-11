import AppKit
import ApplicationServices
import Testing
@testable import Umuo

/// 跑一次会抛 `Refused` 的写回，返回拒绝理由的文案键；没拒绝为 nil。
private func refusalKey(_ body: () throws(AXWriteBack.Refused) -> Void) -> String? {
    do {
        try body()
        return nil
    } catch { return error.text.key }
}

// 身份表是进程级的，测试并行跑：每个测试用自己独有的 pid 造元素，互不干扰。
@Suite("写回目标身份")
struct FocusIdentityTests {
    @Test func 不同元素不能共用身份() {
        let first = AXUIElementCreateApplication(111_111)
        let second = AXUIElementCreateApplication(222_222)
        let token = FrontmostApp.focusToken(first)
        #expect(token != nil)
        #expect(FrontmostApp.focusToken(first) == token)
        #expect(FrontmostApp.focusToken(second) != token)
        #expect(FrontmostApp.focusToken(nil) == nil)
    }

    @Test func 中途查过别的元素_回到原来的输入框身份不变() {
        // 只记「上一个元素」时这里会换新令牌，写回被误拒
        let field = AXUIElementCreateApplication(333_333)
        let other = AXUIElementCreateApplication(444_444)
        let token = FrontmostApp.focusToken(field)
        _ = FrontmostApp.focusToken(other)
        #expect(FrontmostApp.focusToken(field) == token)
    }

    @Test func 最后核对没过_不按键也不动剪贴板_如实上报理由() {
        let board = FakePasteboard("原剪贴板")
        let before = board.changeCount
        let paster = ControlledPaste(pasteboard: board, paste: {
            Issue.record("目标改变后不应发送粘贴")
        }, restoreDelay: 0)
        let key = refusalKey { () throws(AXWriteBack.Refused) in
            try ReplaceSelection.pasteFallback("译文", owner: "1", paster: paster,
                                               frontmost: { "1" }, validate: { UserText("error.secureInput") })
        }
        #expect(key == "error.secureInput")
        #expect(board.string(forType: .string) == "原剪贴板")
        #expect(board.changeCount == before, "核对没过时剪贴板一次都不该写")
    }

    @Test func 取词时没有聚焦元素_仍走粘贴兜底() {
        // Electron / 部分网页视图：AX 查不到聚焦元素，原文靠 ⌘C 取到，替换只能靠 ⌘V
        let probe = FakeTextProbe(), board = Board("用户原来复制的")
        probe.hasFocus = false
        let key = refusalKey { () throws(AXWriteBack.Refused) in
            try ReplaceSelection.replace("译文", original: "原文", owner: "7", probe: probe, paster: board.paster(),
                                         frontmost: { "7" })
        }
        #expect(key == nil)
        #expect(board.pasted == ["译文"])
        #expect(board.current == "用户原来复制的")
    }

    @Test func 最后核对_焦点换了元素() {
        let probe = FakeTextProbe() // 现在聚焦的是 pid 42 的元素
        let earlier = AXUIElementCreateApplication(555_555)
        #expect(ReplaceSelection.finalCheck(earlier, original: "原文", probe: probe)?.key == "error.targetChanged")
    }

    @Test func 最后核对_进了密码框() {
        let probe = FakeTextProbe()
        probe.isSecure = true
        #expect(ReplaceSelection.finalCheck(probe.focusedElement(), original: "原文", probe: probe)?.key
            == "error.secureInput")
        #expect(ReplaceSelection.finalCheck(nil, original: "原文", probe: probe)?.key == "error.secureInput")
    }

    @Test func 最后核对_选区变了() {
        let probe = FakeTextProbe()
        probe.strings["AXSelectedText"] = "别的段落"
        #expect(ReplaceSelection.finalCheck(probe.focusedElement(), original: "原文", probe: probe)?.key
            == "error.selectionChanged")
    }

    @Test func 最后核对_同一个元素且选区未变_放行() {
        let probe = FakeTextProbe()
        probe.strings["AXSelectedText"] = "原文"
        #expect(ReplaceSelection.finalCheck(probe.focusedElement(), original: "原文", probe: probe) == nil)
    }
}
