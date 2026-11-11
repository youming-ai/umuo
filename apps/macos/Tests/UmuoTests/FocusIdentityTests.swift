import AppKit
import ApplicationServices
import Testing
@testable import Umuo

@Suite("写回目标身份")
struct FocusIdentityTests {
    @Test func 不同元素不能共用身份() {
        let first = AXUIElementCreateApplication(111111)
        let second = AXUIElementCreateApplication(222222)
        let token = FrontmostApp.focusToken(first)
        #expect(token != nil)
        #expect(FrontmostApp.focusToken(first) == token)
        #expect(FrontmostApp.focusToken(second) != token)
        #expect(FrontmostApp.focusToken(nil) == nil)
    }

    @Test func 最后校验失败不发送粘贴且恢复剪贴板() {
        let board = FakePasteboard("原剪贴板")
        let paster = ControlledPaste(pasteboard: board, paste: {
            Issue.record("目标改变后不应发送粘贴")
        }, restoreDelay: 0)
        #expect(throws: AXWriteBack.Refused.self) {
            try ReplaceSelection.pasteFallback("译文", owner: "1", paster: paster,
                                               frontmost: { "1" }, validate: { false })
        }
        #expect(board.string(forType: .string) == "原剪贴板")
    }
}
