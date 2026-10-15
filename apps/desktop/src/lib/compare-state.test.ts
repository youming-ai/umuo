import { describe, expect, it } from 'vitest'
import { type CardState, cardMetrics, initialCompareState, reduceCompare } from './compare-state'
import type { CompareDone, CompareStart } from './ipc'

const start: CompareStart = {
  text: 'Hello world',
  targetLang: '中文',
  cards: [
    { index: 0, providerId: 'openai', provider: 'OpenAI', model: 'gpt-4o-mini' },
    { index: 1, providerId: 'deepseek', provider: 'DeepSeek', model: 'deepseek-chat' },
  ],
}

const done: CompareDone = {
  index: 0,
  model: 'gpt-4o-mini',
  totalMs: 1200,
  firstTokenMs: 400,
  inputTokens: 100,
  outputTokens: 30,
  estimated: false,
  costUsd: 0.0001,
}

const card = (state: ReturnType<typeof reduceCompare>, index: number): CardState =>
  state.cards.find((entry) => entry.index === index) as CardState

describe('对比窗状态机', () => {
  it('start 会重建全部卡片，上一轮的译文不残留', () => {
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'delta', index: 0, text: '你' })
    state = reduceCompare(state, { type: 'start', payload: start })
    expect(card(state, 0).text).toBe('')
    expect(card(state, 0).status).toBe('waiting')
    expect(card(state, 1).status).toBe('waiting')
    expect(state.status).toBe('running')
  })

  it('增量只写进它自己那张卡', () => {
    // 没有下标的话，N 路并发输出会串进同一张卡片。
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'delta', index: 0, text: '你' })
    state = reduceCompare(state, { type: 'delta', index: 1, text: '你' })
    state = reduceCompare(state, { type: 'delta', index: 0, text: '好' })
    expect(card(state, 0).text).toBe('你好')
    expect(card(state, 1).text).toBe('你')
  })

  it('落定之后迟到的增量被丢掉', () => {
    // 不丢的话，用户会看到译文在「完成」之后又长出一截。
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'delta', index: 0, text: '你好' })
    state = reduceCompare(state, { type: 'done', payload: done })
    const settled = card(state, 0)
    state = reduceCompare(state, { type: 'delta', index: 0, text: '世界' })
    expect(card(state, 0)).toEqual(settled)
  })

  it('报错保留已经拿到的半段译文', () => {
    // 半段译文对用户仍有价值；抹掉它等于把已经拿到的信息扔掉。
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'delta', index: 0, text: '半段' })
    state = reduceCompare(state, {
      type: 'error',
      payload: { index: 0, message: '限流' },
    })
    expect(card(state, 0).text).toBe('半段')
    expect(card(state, 0).status).toBe('error')
    expect(card(state, 0).error).toBe('限流')
  })

  it('一轮只有在全部卡片都落定之后才算结束', () => {
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'done', payload: done })
    expect(state.status).toBe('running')

    state = reduceCompare(state, {
      type: 'error',
      payload: { index: 1, message: '缺 Key' },
    })
    expect(state.status).toBe('done')
  })

  it('一张卡失败不影响另一张继续输出', () => {
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'error', payload: { index: 0, message: 'boom' } })
    state = reduceCompare(state, { type: 'delta', index: 1, text: '照常' })
    expect(card(state, 1).text).toBe('照常')
    expect(card(state, 1).status).toBe('streaming')
  })

  it('reset 回到初始状态', () => {
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'delta', index: 0, text: 'x' })
    expect(reduceCompare(state, { type: 'reset' })).toEqual(initialCompareState)
  })
})

describe('卡片计量文案', () => {
  it('没有结果时不显示计量', () => {
    const state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    expect(cardMetrics(card(state, 0))).toBeNull()
  })

  it('显示耗时、token 与费用', () => {
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'done', payload: done })
    const line = cardMetrics(card(state, 0)) ?? ''
    expect(line).toContain('首字 400ms')
    expect(line).toContain('100 → 30 tokens')
    expect(line).toContain('$0.0001')
  })

  it('价格未知时说「无价格信息」，不编数字', () => {
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'done', payload: { ...done, costUsd: null } })
    const line = cardMetrics(card(state, 0)) ?? ''
    expect(line).toContain('无价格信息')
    expect(line).not.toContain('$')
  })

  it('估算用量会明确标注', () => {
    let state = reduceCompare(initialCompareState, { type: 'start', payload: start })
    state = reduceCompare(state, { type: 'done', payload: { ...done, estimated: true } })
    expect(cardMetrics(card(state, 0))).toContain('估算')
  })
})
