import AppKit
import Testing
@testable import Umuo

// 浮窗「替换原文」与撰写窗 ⌘⇧↩ 的 ⌘V 兜底：与语音交付同一套受控粘贴（快照 → ⌘V → 延迟按 changeCount 恢复）。
// 假剪贴板（FakePasteboard）+ 假的 ⌘V：不动用户剪贴板、不往别的应用里按键。

private final class Board: @unchecked Sendable {
    let pasteboard: FakePasteboard
    /// 每次 ⌘V 时剪贴板上的文字（目标应用读到的）。
    private(set) var pasted: [String] = []

    init(_ original: String) {
        pasteboard = FakePasteboard(original)
    }

    func paster(fails: Bool = false) -> ControlledPaste {
        ControlledPaste(pasteboard: pasteboard, paste: { () throws(SelectionError) in
            if fails { throw SelectionError.other("无法创建键盘事件") }
            self.pasted.append(self.pasteboard.string(forType: .string) ?? "")
        }, restoreDelay: 0)
    }

    var current: String? { pasteboard.string(forType: .string) }
}

struct ReplaceSelectionPasteTests {
    @Test func 替换原文的粘贴兜底_粘完恢复用户剪贴板() throws {
        let board = Board("用户原来复制的")
        try ReplaceSelection.pasteFallback("译文", paster: board.paster())
        #expect(board.pasted == ["译文"])
        #expect(board.current == "用户原来复制的", "用户剪贴板不该被译文盖掉")
    }

    @Test func 按键失败如实上报_剪贴板还原() {
        let board = Board("用户原来复制的")
        #expect(throws: AXWriteBack.Refused.self) {
            try ReplaceSelection.pasteFallback("译文", paster: board.paster(fails: true))
        }
        #expect(board.current == "用户原来复制的")
    }
}

struct ComposePasteBackTests {
    @Test func 原应用回到前台_粘贴后恢复用户剪贴板() {
        let board = Board("用户原来复制的")
        let failure = ComposeController.pasteBack("Hello", owner: "7", paster: board.paster(),
                                                  refocus: { _ in }, frontmost: { "7" })
        #expect(failure == nil)
        #expect(board.pasted == ["Hello"])
        #expect(board.current == "用户原来复制的")
    }

    @Test func 原应用没回来_不按键_译文留在剪贴板() {
        let board = Board("用户原来复制的")
        let failure = ComposeController.pasteBack("Hello", owner: "7", paster: board.paster(),
                                                  refocus: { _ in }, frontmost: { "9" })
        #expect(failure != nil)
        #expect(board.pasted.isEmpty, "不往不知道是谁的窗口里 ⌘V")
        #expect(board.current == "Hello", "提示说「已复制到剪贴板，可以手动 ⌘V」，就得真在剪贴板上")
    }

    @Test func 没有粘贴目标_译文留在剪贴板() {
        let board = Board("用户原来复制的")
        let failure = ComposeController.pasteBack("Hello", owner: nil, paster: board.paster(),
                                                  refocus: { _ in }, frontmost: { "7" })
        #expect(failure != nil)
        #expect(board.pasted.isEmpty)
        #expect(board.current == "Hello")
    }
}
