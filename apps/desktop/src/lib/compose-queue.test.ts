import { describe, expect, it } from 'vitest'

import { emptyQueue, onInput, onSettled, resetQueue } from './compose-queue'

/**
 * 这些用例守的是一个在真实 UI 里极难复现的失败形态：
 * 用户连续打字时，两次翻译的流式增量交错写进同一个译文区，
 * 结果是一句话前半段来自旧文本、后半段来自新文本。
 */
describe('撰写窗的翻译调度', () => {
  it('空闲时输入会立刻发出去', () => {
    const decision = onInput(emptyQueue, '你好')
    expect(decision.start).toBe('你好')
    expect(decision.queue.streaming).toBe(true)
    expect(decision.queue.pending).toBeNull()
  })

  it('翻译中再次输入只排队，不发第二个请求', () => {
    // 这一条就是「不交错」的核心保证。
    const first = onInput(emptyQueue, '第一版')
    expect(first.start).toBe('第一版')

    const second = onInput(first.queue, '第二版')
    expect(second.start).toBeUndefined()
    expect(second.queue.pending).toBe('第二版')
    expect(second.queue.streaming).toBe(true)
  })

  it('排队时后来的输入覆盖先前的待办（最新一次胜出）', () => {
    const first = onInput(emptyQueue, '第一版')
    const second = onInput(first.queue, '第二版')
    const third = onInput(second.queue, '第三版')
    expect(third.queue.pending).toBe('第三版')
    expect(third.start).toBeUndefined()
  })

  it('上一次结束后立刻发出排队的那一次，然后回到空闲', () => {
    const first = onInput(emptyQueue, '第一版')
    const queued = onInput(first.queue, '第二版')

    const afterFirst = onSettled(queued.queue)
    expect(afterFirst.start).toBe('第二版')
    expect(afterFirst.queue.streaming).toBe(true)

    const afterSecond = onSettled(afterFirst.queue)
    expect(afterSecond.start).toBeUndefined()
    expect(afterSecond.queue).toEqual(emptyQueue)
  })

  it('没有待办时结束就回到空闲', () => {
    const first = onInput(emptyQueue, '只有一次')
    const settled = onSettled(first.queue)
    expect(settled.start).toBeUndefined()
    expect(settled.queue).toEqual(emptyQueue)
  })

  it('清空输入会取消还排着的那一次', () => {
    // 用户把内容删光了，之前排队的那次翻译不该再发出去。
    const first = onInput(emptyQueue, '第一版')
    const queued = onInput(first.queue, '第二版')
    const cleared = onInput(queued.queue, '   ')
    expect(cleared.queue.pending).toBeNull()

    const settled = onSettled(cleared.queue)
    expect(settled.start).toBeUndefined()
    expect(settled.queue).toEqual(emptyQueue)
  })

  it('输入前后空白不改变发出的内容', () => {
    const decision = onInput(emptyQueue, '  你好  ')
    expect(decision.start).toBe('你好')
  })

  it('reset 会丢掉进行中与待办的全部状态', () => {
    const first = onInput(emptyQueue, '第一版')
    const queued = onInput(first.queue, '第二版')
    expect(resetQueue()).toEqual(emptyQueue)
    expect(queued.queue.streaming).toBe(true)
  })
})
