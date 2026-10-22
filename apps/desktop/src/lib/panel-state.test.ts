import { describe, expect, it } from 'vitest'
import { tFor } from './i18n'
import type { DonePayload, ErrorPayload, StartPayload, WordCard } from './ipc'
import {
  costLine,
  favoriteTranslation,
  initialState,
  reduce,
  replaceNotice,
  retranslateMode,
  statusLine,
} from './panel-state'

/** 测试断言的是简体中文文案，与源语言一致。 */
const t = tFor('zh-CN')

const start: StartPayload = {
  requestId: 1,
  text: 'Hello world',
  provider: 'OpenAI',
  model: 'gpt-4o-mini',
  targetLang: '中文',
  wordMode: false,
  mode: 'selection',
}

const done: DonePayload = {
  requestId: 1,
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
  requestId: 1,
  message: '请求过于频繁',
  actions: ['retry', 'switch_model'],
  needsPermission: false,
  permission: null,
  source: null,
}

describe('panel reducer', () => {
  it('start resets everything from the previous translation', () => {
    // 上一次的译文残留在这一次里，是浮窗最容易被漏掉的 bug。
    const dirty = reduce(reduce(initialState, { type: 'start', payload: start }), {
      type: 'delta',
      requestId: 1,
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

  it('a repeated start for the same request drops the failed candidate’s partial output', () => {
    // 故障转移换候选前，后端会用同一个请求 id 再发一次 start（PR #65 审查）。
    // 不清空的话，浮窗里是「旧候选的前几片 + 新候选的全文」。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', requestId: 1, text: '旧的第一片' })
    state = reduce(state, {
      type: 'start',
      payload: { ...start, provider: 'DeepSeek', model: 'deepseek-chat' },
    })
    expect(state.translation).toBe('')
    expect(state.status).toBe('streaming')
    expect(state.model).toBe('deepseek-chat')
    state = reduce(state, { type: 'delta', requestId: 1, text: '新的全文' })
    expect(state.translation).toBe('新的全文')
  })

  it('accumulates deltas in order while streaming', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', requestId: 1, text: '你' })
    state = reduce(state, { type: 'delta', requestId: 1, text: '好' })
    expect(state.translation).toBe('你好')
  })

  it('drops late deltas after the stream has finished', () => {
    // 迟到的增量如果不丢，用户会看到译文在结果行之后又冒出一截。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', requestId: 1, text: '你好' })
    state = reduce(state, { type: 'done', payload: done })
    const after = reduce(state, { type: 'delta', requestId: 1, text: '世界' })
    expect(after).toBe(state)
    expect(after.translation).toBe('你好')
  })

  it('drops late deltas after an error', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'error', payload: error })
    expect(reduce(state, { type: 'delta', requestId: 1, text: 'x' })).toBe(state)
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
        requestId: 1,
        message: '需要屏幕录制权限',
        actions: [],
        needsPermission: true,
        permission: 'screenRecording',
        source: null,
      },
    })
    expect(state.permission).toBe('screenRecording')
  })

  it('clears the permission kind on the next start', () => {
    // 上一次的「缺屏幕录制权限」不该跟着下一次划词翻译继续显示。
    let state = reduce(initialState, {
      type: 'error',
      payload: {
        requestId: 1,
        message: '需要屏幕录制权限',
        actions: [],
        needsPermission: true,
        permission: 'screenRecording',
        source: null,
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
        requestId: 1,
        message: '需要系统权限：辅助功能',
        actions: [],
        needsPermission: true,
        permission: 'accessibility',
        source: null,
      },
    })
    expect(state.needsPermission).toBe(true)
  })

  it('reset returns to the pristine state', () => {
    const state = reduce(reduce(initialState, { type: 'start', payload: start }), {
      type: 'delta',
      requestId: 1,
      text: 'x',
    })
    expect(reduce(state, { type: 'reset' })).toEqual({ ...initialState, requestId: 1 })
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
    state = reduce(state, { type: 'card', requestId: 1, payload: card })
    expect(state.card).toEqual(card)
    expect(state.wordMode).toBe(true)
  })

  it('卡片之后到达的增量被忽略（后端在词卡模式下抑制了 delta）', () => {
    // 后端不会在词卡模式下发 delta；真收到了也不该把 JSON 碎片混进卡片。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'card', requestId: 1, payload: card })
    const after = reduce(state, { type: 'delta', requestId: 1, text: '{"word"' })
    expect(after.card).toEqual(card)
  })

  it('流已经结束之后到达的卡片被丢掉', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'done', payload: done })
    expect(reduce(state, { type: 'card', requestId: 1, payload: card })).toBe(state)
  })

  it('下一次 start 会清掉上一张卡', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'card', requestId: 1, payload: card })
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
    state = reduce(state, { type: 'delta', requestId: 1, text: '抱歉，我无法返回 JSON' })
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
    state = reduce(state, { type: 'delta', requestId: 1, text: '你好世界' })
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

describe('按请求 id 过滤事件（审查 M1 / M15）', () => {
  const newer: StartPayload = { ...start, requestId: 2, text: 'Second' }

  it('换模型重译后，旧请求迟到的增量与完成都被丢掉', () => {
    // 两路译文交错拼在一起、或旧流先结束把新流截断，都源于不认 id。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', requestId: 1, text: '旧' })
    state = reduce(state, { type: 'start', payload: newer })
    state = reduce(state, { type: 'delta', requestId: 1, text: '旧尾巴' })
    state = reduce(state, { type: 'done', payload: done })
    state = reduce(state, { type: 'delta', requestId: 2, text: '新' })
    expect(state.translation).toBe('新')
    expect(state.status).toBe('streaming')
  })

  it('比当前更旧的 start 被丢掉', () => {
    const state = reduce(initialState, { type: 'start', payload: newer })
    expect(reduce(state, { type: 'start', payload: start })).toBe(state)
  })

  it('被顶掉的旧请求报的错（如「已取消」）被丢掉', () => {
    const state = reduce(initialState, { type: 'start', payload: newer })
    expect(reduce(state, { type: 'error', payload: { ...error, requestId: 1 } })).toBe(state)
  })

  it('当前请求出错时保留已经流出来的半段译文', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', requestId: 1, text: '半段' })
    state = reduce(state, { type: 'error', payload: error })
    expect(state.translation).toBe('半段')
    expect(state.source).toBe('Hello world')
  })

  it('没有 start 的新请求出错时，清掉上一次的原文与译文', () => {
    // 在 A 翻出 X，切到 B 什么都没选就按快捷键：「没有选中文本」下面不能还挂着 X，
    // 否则「替换原文」会把 X 写进 B。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', requestId: 1, text: 'X' })
    state = reduce(state, { type: 'done', payload: done })
    state = reduce(state, {
      type: 'error',
      payload: { ...error, requestId: 2, message: '没有选中文本' },
    })
    expect(state.status).toBe('error')
    expect(state.translation).toBe('')
    expect(state.source).toBe('')
    expect(state.metrics).toBeNull()
    expect(state.requestId).toBe(2)
  })

  it('新请求出错时显示它自己的原文，供「重试」使用', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, {
      type: 'error',
      payload: { ...error, requestId: 2, source: 'Second' },
    })
    expect(state.source).toBe('Second')
    expect(state.translation).toBe('')
  })

  it('前端自己构造的错误（id 为 null）算作当前这次', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', requestId: 1, text: '半段' })
    state = reduce(state, { type: 'error', payload: { ...error, requestId: null } })
    expect(state.translation).toBe('半段')
    expect(state.requestId).toBe(1)
  })

  it('reset 带上新的下限后，更早请求的错误不会再冒出来', () => {
    // 撰写窗的回译区：主译文换了就清空，此前那次回译的「已取消」不该再显示。
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'reset', requestId: 2 })
    expect(reduce(state, { type: 'error', payload: error })).toBe(state)
  })

  it('reset 不会把下限往回调', () => {
    // 撰写窗：比回译更早的主译文 start 迟到时也会触发回译区的 reset，
    // 下限一旦回落，那次回译后来的「已取消」就会冒出来。
    let state = reduce(initialState, { type: 'start', payload: { ...start, requestId: 3 } })
    state = reduce(state, { type: 'reset', requestId: 2 })
    expect(state.requestId).toBe(3)
    expect(reduce(state, { type: 'error', payload: { ...error, requestId: 2 } })).toBe(state)
  })
})

describe('retranslateMode（审查 L21）', () => {
  it('OCR 结果窗的重译保住 ocr 模式', () => {
    const state = reduce(initialState, { type: 'start', payload: { ...start, mode: 'ocr' } })
    expect(retranslateMode(state)).toBe('ocr')
  })

  it('其它模式交给后端默认值', () => {
    expect(retranslateMode(reduce(initialState, { type: 'start', payload: start }))).toBeNull()
    const silent = reduce(initialState, {
      type: 'start',
      payload: { ...start, mode: 'silentReplace' },
    })
    expect(retranslateMode(silent)).toBeNull()
  })
})

describe('favoriteTranslation（审查 L23）', () => {
  it('完成后存完整译文', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', requestId: 1, text: '你好世界' })
    state = reduce(state, { type: 'done', payload: done })
    expect(favoriteTranslation(state)).toBe('你好世界')
  })

  it('流式中途不存半截译文', () => {
    let state = reduce(initialState, { type: 'start', payload: start })
    state = reduce(state, { type: 'delta', requestId: 1, text: '你好' })
    expect(favoriteTranslation(state)).toBeNull()
  })

  it('词卡模式没有纯文本译文时存 null 而不是空串', () => {
    let state = reduce(initialState, { type: 'start', payload: { ...start, wordMode: true } })
    state = reduce(state, { type: 'done', payload: done })
    expect(favoriteTranslation(state)).toBeNull()
  })
})
