import AppKit
import Testing
@testable import Umuo

private final class CopyWatch: ClipboardCopyWatching {
    var interrupted = false
    var stopped = false
    func wasInterrupted() -> Bool { interrupted }
    func stop() { stopped = true }
}

struct ClipboardFallbackTests {
    @Test func 应用先清空后写数据_等文本就位才恢复快照() throws {
        let board = FakePasteboard("旧内容")
        let watch = CopyWatch()
        var polls = 0
        let fallback = ClipboardFallback(pasteboard: board, copy: { board.clearContents() },
                                         beginWatching: { watch }, wait: { _ in
                                             polls += 1
                                             if polls == 2 { board.setString("选中的文字", forType: .string) }
                                         })
        #expect(try fallback.read() == "选中的文字")
        #expect(polls == 2)
        #expect(board.string(forType: .string) == "旧内容")
    }

    @Test func 应用的写入恰好落在读取期间_没有用户操作就继续等而不是放弃() throws {
        // 源应用先 clearContents 再写数据，第二步落在我们读文本的那一刻：版本号在读取前后不同，
        // 但观察器没看到任何用户操作——这是复制本身还没写完，不是用户插手，应当继续轮询。
        let board = FakePasteboard("旧内容")
        let watch = CopyWatch()
        var reads = 0
        let fallback = ClipboardFallback(pasteboard: board, copy: { board.clearContents() },
                                         beginWatching: { watch }, wait: { _ in })
        board.onString = {
            reads += 1
            if reads == 2 { board.setString("选中的文字", forType: .string) }
        }
        let text = try fallback.read()
        board.onString = nil
        #expect(text == "选中的文字")
        #expect(board.string(forType: .string) == "旧内容")
        #expect(watch.stopped)
    }

    @Test func 用户中途复制_不读取为选区也不覆盖新内容() {
        let board = FakePasteboard("旧内容")
        let watch = CopyWatch()
        let fallback = ClipboardFallback(pasteboard: board, copy: {}, beginWatching: { watch }, wait: { _ in
            watch.interrupted = true
            board.setString("用户新复制的", forType: .string)
        })
        #expect(throws: SelectionError.other(UserText(Pasteboard.changed))) { try fallback.read() }
        #expect(board.string(forType: .string) == "用户新复制的")
        #expect(watch.stopped)
    }

    @Test func 用户只是继续打字_剪贴板尚未变化就还原原内容() {
        let board = FakePasteboard("旧内容")
        let watch = CopyWatch()
        let fallback = ClipboardFallback(pasteboard: board, copy: {}, beginWatching: { watch }, wait: { _ in
            watch.interrupted = true
        })
        #expect(throws: SelectionError.other(UserText(Pasteboard.changed))) { try fallback.read() }
        #expect(board.string(forType: .string) == "旧内容")
    }

    @Test func 合成失败期间剪贴板已变化_不恢复旧快照() {
        let board = FakePasteboard("旧内容")
        let watch = CopyWatch()
        let failure = SelectionError.other(UserText("error.keyEventFailed"))
        let fallback = ClipboardFallback(pasteboard: board, copy: { () throws(SelectionError) in
            board.setString("新内容", forType: .string)
            throw failure
        }, beginWatching: { watch })
        #expect(throws: failure) { try fallback.read() }
        #expect(board.string(forType: .string) == "新内容")
    }

    @Test func 无法观察用户操作_不清空剪贴板也不发复制() {
        let board = FakePasteboard("旧内容")
        let count = board.changeCount
        var copied = false
        let fallback = ClipboardFallback(pasteboard: board, copy: { copied = true }, beginWatching: { nil })
        #expect(throws: SelectionError.other(UserText("error.clipboardUnavailable"))) { try fallback.read() }
        #expect(!copied)
        #expect(board.changeCount == count)
    }

    @Test func 慢应用在同一次轮询返回_取到文字并完整还原() throws {
        let board = FakePasteboard()
        board.writeItems([[
            .init(type: "public.utf8-plain-text", data: Data("旧内容".utf8)),
            .init(type: "public.png", data: Data([1, 2, 3])),
        ]])
        let snapshot = Pasteboard.Snapshot.take(board)
        let watch = CopyWatch()
        var polls = 0
        let fallback = ClipboardFallback(pasteboard: board, copy: {}, beginWatching: { watch }, wait: { _ in
            polls += 1
            if polls == 35 { board.setString("慢应用的选区", forType: .string) }
        })
        #expect(try fallback.read() == "慢应用的选区")
        #expect(polls == 35)
        #expect(Pasteboard.Snapshot.take(board) == snapshot)
    }

    @Test func 超时后不再观察和覆盖后来的复制() {
        let board = FakePasteboard("旧内容")
        let watch = CopyWatch()
        var polls = 0
        let fallback = ClipboardFallback(pasteboard: board, copy: {}, beginWatching: { watch }, wait: { _ in polls += 1 })
        #expect(throws: SelectionError.noSelection) { try fallback.read() }
        #expect(board.string(forType: .string) == "旧内容")
        #expect(polls == ClipboardFallback.pollAttempts)
        #expect(watch.stopped)
        board.setString("之后复制的", forType: .string)
        #expect(board.string(forType: .string) == "之后复制的")
    }
}
