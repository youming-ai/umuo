/**
 * 撰写窗的翻译调度：**最新一次输入胜出**。
 *
 * 为什么需要它：防抖只能减少请求数，消不掉「上一次还在流式返回、下一次已经该发了」。
 * 并发发两个请求会让两段 delta 交错写进同一个译文区——用户看到的是一句话里
 * 前半段来自旧文本、后半段来自新文本。所以这里排队：翻译中到达的新文本只记下来，
 * 等当前这次结束再发。
 *
 * 抽成纯函数是因为这是撰写窗里唯一有真实时序逻辑的地方，而时序 bug
 * 在 UI 里极难复现，在纯函数里却是一行断言的事。
 */

export interface ComposeQueue {
  /** 是否正在流式翻译。 */
  streaming: boolean
  /** 翻译中收到的最新文本；`null` 表示没有待办。 */
  pending: string | null
}

export const emptyQueue: ComposeQueue = { streaming: false, pending: null }

export interface QueueDecision {
  queue: ComposeQueue
  /** 现在就应该发出去的文本；`undefined` 表示这次什么都不发。 */
  start?: string
}

export function resetQueue(): ComposeQueue {
  return emptyQueue
}

/**
 * 用户（防抖之后）输入了新文本。
 *
 * 空文本会清掉待办：用户把内容删光了，之前排队的那次翻译就不该再发出去。
 */
export function onInput(queue: ComposeQueue, text: string): QueueDecision {
  const trimmed = text.trim()
  if (!trimmed) {
    return { queue: { ...queue, pending: null } }
  }
  if (queue.streaming) {
    // 正在翻译：记成待办，覆盖掉更早的待办（最新的输入才是用户想看的）。
    return { queue: { streaming: true, pending: trimmed } }
  }
  return { queue: { streaming: true, pending: null }, start: trimmed }
}

/** Rust 侧报了一次结束（done 或 error）。有排队就立刻发下一次。 */
export function onSettled(queue: ComposeQueue): QueueDecision {
  if (queue.pending) {
    return { queue: { streaming: true, pending: null }, start: queue.pending }
  }
  return { queue: emptyQueue }
}
