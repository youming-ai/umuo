import AppKit
import Testing
@testable import Umuo

@MainActor
private final class DraftSave {
    var waiting: CheckedContinuation<Void, Error>?
    lazy var task = Task<Void, Error> { @MainActor in
        try await withCheckedThrowingContinuation { waiting = $0 }
    }

    func reject() async {
        waiting?.resume(throwing: URLError(.cannotWriteToFile))
        _ = await task.result
        // 保存结果的 UI 回调在另一个主线程任务里。
        for _ in 0 ..< 30 { await Task.yield() }
    }
}

@MainActor
struct DraftFieldTests {
    @Test func 旧保存失败不抹掉后来继续输入的草稿() async throws {
        let save = DraftSave()
        let field = NSTextField()
        let coordinator = DraftField.Coordinator(DraftField(value: "A", onCommit: { _ in save.task }))
        field.stringValue = "B"
        coordinator.controlTextDidEndEditing(Notification(name: NSText.didEndEditingNotification, object: field))
        for _ in 0 ..< 30 { await Task.yield() }
        try #require(save.waiting != nil)
        field.stringValue = "C"
        coordinator.controlTextDidChange(Notification(name: NSText.didChangeNotification, object: field))
        await save.reject()
        #expect(field.stringValue == "C")
    }

    @Test func 改过又改回提交文字_也属于新草稿() async throws {
        let save = DraftSave()
        let field = NSTextField()
        let coordinator = DraftField.Coordinator(DraftField(value: "A", onCommit: { _ in save.task }))
        field.stringValue = "B"
        coordinator.controlTextDidEndEditing(Notification(name: NSText.didEndEditingNotification, object: field))
        for _ in 0 ..< 30 { await Task.yield() }
        try #require(save.waiting != nil)
        field.stringValue = "C"
        coordinator.controlTextDidChange(Notification(name: NSText.didChangeNotification, object: field))
        field.stringValue = "B"
        coordinator.controlTextDidChange(Notification(name: NSText.didChangeNotification, object: field))
        await save.reject()
        #expect(field.stringValue == "B")
    }

    @Test func 未继续编辑时保存失败仍退回已保存的值() async throws {
        let save = DraftSave()
        let field = NSTextField()
        let coordinator = DraftField.Coordinator(DraftField(value: "A", onCommit: { _ in save.task }))
        field.stringValue = "B"
        coordinator.controlTextDidEndEditing(Notification(name: NSText.didEndEditingNotification, object: field))
        for _ in 0 ..< 30 { await Task.yield() }
        try #require(save.waiting != nil)
        await save.reject()
        #expect(field.stringValue == "A")
    }

    @Test func 多行框也保留新草稿() async throws {
        let save = DraftSave()
        let text = NSTextView()
        let coordinator = DraftField.Coordinator(DraftField(value: "A", onCommit: { _ in save.task }))
        text.string = "B"
        coordinator.textDidEndEditing(Notification(name: NSText.didEndEditingNotification, object: text))
        for _ in 0 ..< 30 { await Task.yield() }
        try #require(save.waiting != nil)
        text.string = "C"
        coordinator.textDidChange(Notification(name: NSText.didChangeNotification, object: text))
        await save.reject()
        #expect(text.string == "C")
    }
}
