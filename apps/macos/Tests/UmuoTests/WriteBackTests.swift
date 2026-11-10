import AppKit
import Testing
import UmuoCore
@testable import Umuo

// 浮窗「替换原文」与静默翻译写回的守卫：每道检查不过时什么都不写（没有 AX 写入、没有 ⌘V），并给出对应的拒绝理由。
// 假 AX（FakeTextProbe）、假剪贴板（Board / FakePasteboard）、假的 ⌘V：不碰真实辅助功能、不动用户剪贴板、不按键。

/// 假的聚焦文本目标：现查到什么由测试设定；记录每次 AX 写入。
final class FakeTextProbe: FocusedTextProbing, @unchecked Sendable {
    struct Write: Equatable {
        let attribute: String
        let text: String
    }

    var isTrusted = true
    var hasFocus = true
    /// 按属性名回答可写性；没设的属性答「问不出来」（nil）。
    var settable: [String: Bool] = [:]
    /// 按属性名回答内容；没设的属性读不出（nil）。
    var strings: [String: String] = [:]
    var writeSucceeds = true
    /// 聚焦的是密码框 / 安全输入开着。
    var isSecure = false
    private(set) var writes: [Write] = []

    func trusted() -> Bool { isTrusted }
    func focusedElement() -> AXUIElement? { hasFocus ? AXUIElementCreateApplication(42) : nil }
    func isSettable(_: AXUIElement, _ attribute: String) -> Bool? { settable[attribute] }
    func string(_: AXUIElement, _ attribute: String) -> String? { strings[attribute] }
    func secureInput(_: AXUIElement?) -> Bool { isSecure }
    func write(_ text: String, to _: AXUIElement, _ attribute: String) -> Bool {
        writes.append(Write(attribute: attribute, text: text))
        return writeSucceeds
    }
}

private let selected = "AXSelectedText"
private let value = "AXValue"

/// 跑一次会抛 `Refused` 的写回，返回拒绝理由的文案键；没拒绝为 nil。
private func refusal(_ body: () throws(AXWriteBack.Refused) -> Void) -> String? {
    do {
        try body()
        return nil
    } catch { return error.text.key }
}

@Suite("PanelReplaceGuards")
struct PanelReplaceGuardTests {
    private let en = Translate(locale: .en)

    /// 浮窗替换原文：前台恒为 "7"（源应用），选区可写、仍是原文，除非测试改掉。
    private func replace(_ probe: FakeTextProbe, _ board: Board) -> String? {
        refusal { () throws(AXWriteBack.Refused) in
            try ReplaceSelection.replace("译文", original: "原文", owner: "7", probe: probe, paster: board.paster(),
                                         frontmost: { "7" })
        }
    }

    private func readableSelection(settable: Bool? = true, current: String = "原文") -> FakeTextProbe {
        let probe = FakeTextProbe()
        if let settable { probe.settable[selected] = settable }
        probe.strings[selected] = current
        return probe
    }

    @Test func 没有辅助功能权限_不写不粘() {
        let probe = readableSelection(), board = Board("用户原来复制的")
        probe.isTrusted = false
        #expect(replace(probe, board) == "error.accessibilityRequired")
        #expect(probe.writes.isEmpty)
        #expect(board.pasted.isEmpty)
    }

    @Test func 取词后焦点换到密码框_不写不粘() {
        // 密码框读不出选区，没有这道检查会跳过「选区未变」直接 ⌘V 粘进去
        let probe = FakeTextProbe(), board = Board("用户原来复制的")
        probe.isSecure = true
        #expect(replace(probe, board) == "error.secureInput")
        #expect(probe.writes.isEmpty)
        #expect(board.pasted.isEmpty)
    }

    @Test func 写入前前台换了_不写不粘() {
        let probe = readableSelection(), board = Board("用户原来复制的")
        // 第一次（计划）还是源应用，第二次（写入前的守卫）已经切走
        var answers = ["7", "9"]
        let result = PanelController.replaceSource("译文", original: "原文", owner: "7", t: en,
                                                   frontmost: { answers.isEmpty ? "9" : answers.removeFirst() },
                                                   refocus: { _ in }, probe: probe, paster: board.paster())
        #expect(result == "目标应用已切换，已放弃替换原文")
        #expect(probe.writes.isEmpty)
        #expect(board.pasted.isEmpty)
    }

    @Test(arguments: ["别的段落", "原", ""])
    func 读得出选区但已不是原文_不写不粘(current: String) {
        // "" = 选区塌成了光标
        let probe = readableSelection(current: current), board = Board("用户原来复制的")
        #expect(replace(probe, board) == "error.selectionChanged")
        #expect(probe.writes.isEmpty)
        #expect(board.pasted.isEmpty)
    }

    @Test func 读得出选区且明确只读_不写不粘() {
        // 终端的滚动缓冲区：⌘V 会把译文打进 shell
        let probe = readableSelection(settable: false), board = Board("用户原来复制的")
        #expect(replace(probe, board) == "error.selectionReadOnly")
        #expect(probe.writes.isEmpty)
        #expect(board.pasted.isEmpty)
    }

    @Test func AX写入被拒_退回受控粘贴() {
        let probe = readableSelection(), board = Board("用户原来复制的")
        probe.writeSucceeds = false
        let result = PanelController.replaceSource("译文", original: "原文", owner: "7", t: en,
                                                   frontmost: { "7" }, refocus: { _ in }, probe: probe,
                                                   paster: board.paster())
        #expect(result == nil)
        #expect(probe.writes == [.init(attribute: selected, text: "译文")])
        #expect(board.pasted == ["译文"])
        #expect(board.current == "用户原来复制的")
    }

    @Test func AX写入成功_不粘贴不碰剪贴板() {
        let probe = readableSelection(), board = Board("用户原来复制的")
        let changeCount = board.pasteboard.changeCount
        let result = PanelController.replaceSource("译文", original: "原文", owner: "7", t: en,
                                                   frontmost: { "7" }, refocus: { _ in }, probe: probe,
                                                   paster: board.paster())
        #expect(result == nil)
        #expect(probe.writes == [.init(attribute: selected, text: "译文")])
        #expect(board.pasted.isEmpty)
        #expect(board.pasteboard.changeCount == changeCount)
    }
}

@Suite("SilentWriteBackGuards")
struct SilentWriteBackGuardTests {
    private func replace(_ source: FocusSource, _ probe: FakeTextProbe) -> String? {
        refusal { () throws(AXWriteBack.Refused) in
            try AXWriteBack.replace(source, original: "原文", text: "译文", probe: probe)
        }
    }

    private func field(_ attribute: String, settable: Bool? = true, current: String? = "原文") -> FakeTextProbe {
        let probe = FakeTextProbe()
        if let settable { probe.settable[attribute] = settable }
        if let current { probe.strings[attribute] = current }
        return probe
    }

    @Test func 没有辅助功能权限_不写() {
        let probe = field(selected)
        probe.isTrusted = false
        #expect(replace(.selection, probe) == "error.accessibilityRequired")
        #expect(probe.writes.isEmpty)
    }

    @Test(arguments: [FocusSource.selection, .wholeField])
    func 密码框或安全输入_不写(source: FocusSource) {
        let probe = field(AXWriteBack.attribute(source))
        probe.isSecure = true
        #expect(replace(source, probe) == "error.secureInput")
        #expect(probe.writes.isEmpty)
    }

    @Test func 选区明确只读_不写() {
        let probe = field(selected, settable: false)
        #expect(replace(.selection, probe) == "error.selectionReadOnly")
        #expect(probe.writes.isEmpty)
    }

    @Test(arguments: [false, nil] as [Bool?])
    func 整框不可写或问不出来_不写(settable: Bool?) {
        let probe = field(value, settable: settable)
        #expect(replace(.wholeField, probe) == "error.fieldNotReplaceable")
        #expect(probe.writes.isEmpty)
    }

    @Test func 没有聚焦元素_整框按问不出来拒绝() {
        let probe = field(value)
        probe.hasFocus = false
        #expect(replace(.wholeField, probe) == "error.fieldNotReplaceable")
        #expect(probe.writes.isEmpty)
    }

    @Test func 原文已变_不写() {
        let selection = field(selected, current: "别的段落")
        #expect(replace(.selection, selection) == "error.selectionChanged")
        #expect(selection.writes.isEmpty)
        let whole = field(value, current: "原文，又打了几个字")
        #expect(replace(.wholeField, whole) == "error.fieldChanged")
        #expect(whole.writes.isEmpty)
    }

    @Test func 写入被拒_报写入失败() {
        let probe = field(selected)
        probe.writeSucceeds = false
        #expect(replace(.selection, probe) == "error.writeRejected")
    }

    @Test func 选区写AXSelectedText_整框写AXValue() {
        let selection = field(selected)
        #expect(replace(.selection, selection) == nil)
        #expect(selection.writes == [.init(attribute: selected, text: "译文")])
        let whole = field(value)
        #expect(replace(.wholeField, whole) == nil)
        #expect(whole.writes == [.init(attribute: value, text: "译文")])
    }
}
