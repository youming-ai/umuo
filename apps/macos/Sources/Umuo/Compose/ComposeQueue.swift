import Foundation

/// 撰写窗的翻译调度：**最新一次输入胜出**。
///
/// 防抖只能减少请求数，消不掉「上一次还在流式返回、下一次已经该发了」。并发发两个请求会让两段增量
/// 交错写进同一个译文区——一句话前半段来自旧文本、后半段来自新文本。所以这里排队：翻译中到达的新文本
/// 只记下来，等当前这次结束再发。
struct ComposeQueue: Equatable, Sendable {
    /// 是否正在流式翻译。
    var streaming = false
    /// 翻译中收到的最新文本；nil 表示没有待办。
    var pending: String?

    static let empty = ComposeQueue()

    struct Decision: Equatable, Sendable {
        var queue: ComposeQueue
        /// 现在就应该发出去的文本；nil 表示这次什么都不发。
        var start: String?
    }

    /// 用户（防抖之后）输入了新文本。空文本会清掉待办：用户把内容删光了，之前排队的那次就不该再发。
    func onInput(_ text: String) -> Decision {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return Decision(queue: ComposeQueue(streaming: streaming, pending: nil))
        }
        if streaming {
            // 正在翻译：记成待办，覆盖掉更早的待办（最新的输入才是用户想看的）。
            return Decision(queue: ComposeQueue(streaming: true, pending: trimmed))
        }
        return Decision(queue: ComposeQueue(streaming: true, pending: nil), start: trimmed)
    }

    /// 这一次结束了（done 或 error）。有排队就立刻发下一次。
    func onSettled() -> Decision {
        if let pending, !pending.isEmpty {
            return Decision(queue: ComposeQueue(streaming: true, pending: nil), start: pending)
        }
        return Decision(queue: .empty)
    }
}
