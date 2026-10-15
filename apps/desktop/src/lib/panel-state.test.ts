import { describe, expect, it } from 'vitest'
import { tFor } from './i18n'
import type { DonePayload, ErrorPayload, StartPayload, WordCard } from './ipc'
import { costLine, initialState, reduce, replaceNotice, statusLine } from './panel-state'

/** 测试断言的是简体中文文案，与源语言一致。 */
const t = tFor('zh-CN')

const start: StartPayload = {
  text: 'Hello world',
  provider: 'OpenAI',
  model: 'gpt-4o-mini',
  targetLang: '中文',
  wordMode: false,
  mode: 'selection',
}

const done: DonePayload = {
  model: 'gpt-4o-mini',
  inputTokens: 120,
  outputTokens: 40,
  estimated: false,
  costUsd: 0.000104,
  firstTokenMs: 420,
  totalMs: 900,
  replaced: false,
  warning: null,
  offline: false,
}

const error: ErrorPayload = {
  message: '请求过于频繁',
  actions: ['retry', 'switch_model'],
  needsPermission: false,
  permission: null,
}

describe('panel reducer', () => {
  it('start resets everything from the previous translation', () => {
    // 上一次的译文残留在这一次里，是浮窗最容易被漏掉的 bug。
    const dirty = reduce(reduce(initialState, { type: 'start', payload: start }), {
      type: 'delta',
      text: '你好',
    })
    const fresh = reduce(dirty, {
      type: 'start',
      payload: { ...start, text: 'Another sentence' },
    })
    expect(fresh.translation).toBe('')
    expect(fresh.source).toBe('Another sentence')
    expect(fresh.status).toBe('streaming')
    expect(fresh.metrics).toBeNull()
    expect(fresh.error).toBeNull()
  })

  it('accumulates deltas in order while streaming', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', text: '你' })
    state = reduce(state, { type: 'delta', text: '好' })
    expect(state.translation).toBe('你好')
  })

  it('drops late deltas after the stream has finished', () => {
    // 迟到的增量如果不丢，用户会看到译文在结果行之后又冒出一截。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', text: '你好' })
    state = reduce(state, { type: 'done', payload: done })
    const after = reduce(state, { type: 'delta', text: '世界' })
    expect(after).toBe(state)
    expect(after.translation).toBe('你好')
  })

  it('drops late deltas after an error', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'error', payload: error })
    expect(reduce(state, { type: 'delta', text: 'x' })).toBe(state)
  })

  it('ignores done when no translation was started', () => {
    expect(reduce(initialState, { type: 'done', payload: done })).toBe(initialState)
  })

  it('reports the model that actually served, not the one start announced', () => {
    // 故障转移之后 start 里那个模型已经不是真正干活的了。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'done', payload: { ...done, model: 'deepseek-chat' } })
    expect(state.model).toBe('deepseek-chat')
    expect(statusLine(state, t)).toBe('OpenAI · deepseek-chat · 中文')
  })

  it('surfaces actionable errors instead of a bare message', () => {
    const state = reduce(reduce(initialState, { type: 'start', payload: start }), {
      type: 'error',
      payload: error,
    })
    expect(state.status).toBe('error')
    expect(state.errorActions).toEqual(['retry', 'switch_model'])
  })

  it('records WHICH permission is missing so the panel opens the right pane', () => {
    // 截图缺权限被引导到「辅助功能」，用户照做之后仍然用不了——比不提示更糟。
    const state = reduce(initialState, {
      type: 'error',
      payload: {
        message: '需要屏幕录制权限',
        actions: [],
        needsPermission: true,
        permission: 'screenRecording',
      },
    })
    expect(state.permission).toBe('screenRecording')
  })

  it('clears the permission kind on the next start', () => {
    // 上一次的「缺屏幕录制权限」不该跟着下一次划词翻译继续显示。
    let state = reduce(initialState, {
      type: 'error',
      payload: {
        message: '需要屏幕录制权限',
        actions: [],
        needsPermission: true,
        permission: 'screenRecording',
      },
    })
    state = reduce(state, { type: 'start', payload: start })
    expect(state.permission).toBeNull()
    expect(state.needsPermission).toBe(false)
  })

  it('marks permission failures so the panel shows a permission hint', () => {
    const state = reduce(initialState, {
      type: 'error',
      payload: {
        message: '需要系统权限：辅助功能',
        actions: [],
        needsPermission: true,
        permission: 'accessibility',
      },
    })
    expect(state.needsPermission).toBe(true)
  })

  it('reset returns to the pristine state', () => {
    const state = reduce(reduce(initialState, { type: 'start', payload: start }), {
      type: 'delta',
      text: 'x',
    })
    expect(reduce(state, { type: 'reset' })).toEqual(initialState)
  })
})

describe('cost line', () => {
  it('is absent until the request completes', () => {
    expect(costLine(null, t)).toBeNull()
  })

  it('shows tokens, cost and latency', () => {
    const line = costLine(done, t)
    expect(line).toContain('120 → 40 tokens')
    expect(line).toContain('$0.0001')
    expect(line).toContain('首字 420ms')
  })

  it('says "无价格信息" instead of inventing a number when the model is not priced', () => {
    const line = costLine({ ...done, costUsd: null }, t)
    expect(line).toContain('无价格信息')
    expect(line).not.toContain('$')
  })

  it('labels estimated usage', () => {
    expect(costLine({ ...done, estimated: true }, t)).toContain('估算')
  })

  it('falls back to total latency when there was no streamed first token', () => {
    const line = costLine({ ...done, firstTokenMs: null }, t)
    expect(line).toContain('900ms')
    expect(line).not.toContain('首字')
  })
})

describe('status line', () => {
  it('omits missing parts rather than showing separators for them', () => {
    expect(statusLine(initialState, t)).toBe('')
    expect(statusLine({ ...initialState, provider: 'OpenAI' }, t)).toBe('OpenAI')
  })
})

const card: WordCard = {
  word: 'hello',
  phonetic: '/həˈloʊ/',
  senses: [{ partOfSpeech: 'int.', definition: '你好' }],
  forms: [],
  examples: [{ source: 'Hello there', target: '你好' }],
}

describe('月度上限提醒', () => {
  it('提醒随 done 一起到达，且不算错误', () => {
    // 翻译是成功的，只是结果来自另一个供应商。渲染成错误块会让用户以为没翻出来。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, {
      type: 'done',
      payload: { ...done, warning: 'openai 本月已花 $6.50（上限 $5.00），本次已改用 deepseek' },
    })
    expect(state.status).toBe('done')
    expect(state.warning).toContain('deepseek')
  })

  it('没有提醒时是 null，不是空字符串', () => {
    // 空字符串在界面上会渲染出一个空的提示条。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'done', payload: done })
    expect(state.warning).toBeNull()
  })

  it('下一次 start 会清掉上一次的提醒', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'done', payload: { ...done, warning: '超限' } })
    expect(reduce(state, { type: 'start', payload: start }).warning).toBeNull()
  })
})

describe('单词词卡', () => {
  it('卡片事件写入状态，供浮窗渲染卡片而不是纯文本', () => {
    let state = reduce(initialState, {
      type: 'start',
      payload: { ...start, text: 'hello', wordMode: true },
    })
    state = reduce(state, { type: 'card', payload: card })
    expect(state.card).toEqual(card)
    expect(state.wordMode).toBe(true)
  })

  it('卡片之后到达的增量被忽略（后端在词卡模式下抑制了 delta）', () => {
    // 后端不会在词卡模式下发 delta；真收到了也不该把 JSON 碎片混进卡片。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'card', payload: card })
    const after = reduce(state, { type: 'delta', text: '{"word"' })
    expect(after.card).toEqual(card)
  })

  it('流已经结束之后到达的卡片被丢掉', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'done', payload: done })
    expect(reduce(state, { type: 'card', payload: card })).toBe(state)
  })

  it('下一次 start 会清掉上一张卡', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'card', payload: card })
    state = reduce(state, { type: 'done', payload: done })
    const next = reduce(state, { type: 'start', payload: start })
    expect(next.card).toBeNull()
  })

  it('解析失败降级时没有卡片，走纯文本路径', () => {
    // PRD §6.5：词卡 JSON 解析失败时要降级为纯文本展示，而不是显示空白。
    let state = reduce(initialState, {
      type: 'start',
      payload: { ...start, wordMode: true },
    })
    state = reduce(state, { type: 'delta', text: '抱歉，我无法返回 JSON' })
    expect(state.card).toBeNull()
    expect(state.translation).toBe('抱歉，我无法返回 JSON')
  })
})

describe('静默翻译（原地替换）', () => {
  const silentStart: StartPayload = { ...start, mode: 'silentReplace' }

  it('划词模式下不显示任何替换提示', () => {
    const state = reduce(initialState, { type: 'start', payload: start })
    expect(replaceNotice(state, t)).toBeNull()
  })

  it('静默模式翻译中就说明「完成后会替换原处」', () => {
    // 按下 ⌥⇧T 之后原文还在，必须让用户知道接下来原文会被改掉。
    const state = reduce(initialState, { type: 'start', payload: silentStart })
    expect(replaceNotice(state, t)).toBe('完成后会替换原处…')
  })

  it('写回成功后明确说「原文已替换」', () => {
    let state = reduce(initialState, { type: 'start', payload: silentStart })
    state = reduce(state, { type: 'delta', text: '你好世界' })
    state = reduce(state, { type: 'done', payload: { ...done, replaced: true } })
    expect(state.replaced).toBe(true)
    expect(replaceNotice(state, t)).toBe('原文已替换')
  })

  it('写回被拦下时不谎称已替换', () => {
    // 目标应用切换时后端会放弃写回。这时若还显示「原文已替换」，
    // 用户就会以为改成功了，而原文其实一动没动。
    let state = reduce(initialState, { type: 'start', payload: silentStart })
    state = reduce(state, { type: 'done', payload: { ...done, replaced: false } })
    expect(state.replaced).toBe(false)
    expect(replaceNotice(state, t)).toBeNull()
  })

  it('报错时也不显示替换提示', () => {
    let state = reduce(initialState, { type: 'start', payload: silentStart })
    state = reduce(state, { type: 'error', payload: error })
    expect(replaceNotice(state, t)).toBeNull()
  })

  it('下一次 start 会把替换状态清干净', () => {
    let state = reduce(initialState, { type: 'start', payload: silentStart })
    state = reduce(state, { type: 'done', payload: { ...done, replaced: true } })
    const next = reduce(state, { type: 'start', payload: start })
    expect(next.replaced).toBe(false)
    expect(next.mode).toBe('selection')
  })
})

describe('离线回落的显示（PRD §7.5）', () => {
  const base = {
    ...initialState,
    provider: 'OpenAI',
    model: 'llama3.1:8b',
    targetLang: '简体中文',
  }

  it('离线时标出「离线」，并且不沿用原来那家云端厂商的名字', () => {
    // 显示「OpenAI · llama3.1:8b」比不显示更让人困惑：那个模型不是 OpenAI 的。
    const line = statusLine({ ...base, offline: true }, t)
    expect(line).toContain('离线')
    expect(line).toContain('llama3.1:8b')
    expect(line).not.toContain('OpenAI')
  })

  it('正常翻译时不出现「离线」字样', () => {
    const line = statusLine({ ...base, offline: false }, t)
    expect(line).toContain('OpenAI')
    expect(line).not.toContain('离线')
  })
})
