import { describe, expect, it } from 'vitest'

import {
  dailyBars,
  dayBarTitle,
  favoriteMeta,
  formatTimestamp,
  recordMeta,
  sceneLabel,
  usageLine,
} from './history-format'
import { tFor } from './i18n'
import type { DayUsage, HistoryRecord, Usage } from './ipc'

/** 测试断言的是简体中文文案，与源语言一致。 */
const t = tFor('zh-CN')

const record: HistoryRecord = {
  id: 1,
  createdAt: 1_700_000_000,
  sourceText: 'Hello',
  translatedText: '你好',
  sourceLang: 'en',
  targetLang: 'zh-CN',
  providerId: 'openai',
  model: 'gpt-4o-mini',
  styleId: 'standard',
  scene: 'selection',
  sourceApp: 'Safari',
  inputTokens: 100,
  outputTokens: 40,
  estimated: false,
  costUsd: 0.0001,
}

describe('场景标签', () => {
  it('把内部场景键翻成用户看得懂的中文', () => {
    expect(sceneLabel('selection', t)).toBe('划词')
    expect(sceneLabel('silentReplace', t)).toBe('原地替换')
    expect(sceneLabel('compose', t)).toBe('撰写窗')
    expect(sceneLabel('compare', t)).toBe('对比')
  })

  it('未知场景原样显示，而不是显示「未知」', () => {
    // 以后新增场景时，历史里出现一个英文键也比「未知」更能说明问题。
    expect(sceneLabel('somethingNew', t)).toBe('somethingNew')
  })
})

describe('时间格式', () => {
  it('按本地时间输出到分钟', () => {
    // 用本地时间构造，避免测试受运行机器时区影响。
    const local = new Date(2026, 4, 6, 9, 5).getTime() / 1000
    expect(formatTimestamp(local)).toBe('2026-05-06 09:05')
  })
})

describe('记录元信息', () => {
  it('包含模型、场景、token 与费用', () => {
    const meta = recordMeta(record, t)
    expect(meta).toContain('openai · gpt-4o-mini')
    expect(meta).toContain('划词')
    expect(meta).toContain('100 → 40 tokens')
    expect(meta).toContain('$0.0001')
    expect(meta).toContain('Safari')
  })

  it('价格未知时说「未计价」，不显示 $0', () => {
    // 显示 $0.0000 会让人以为这次翻译是免费的。
    const meta = recordMeta({ ...record, costUsd: null }, t)
    expect(meta).toContain('未计价')
    expect(meta).not.toContain('$')
  })

  it('用量是估算时明确标注', () => {
    expect(recordMeta({ ...record, estimated: true }, t)).toContain('估算')
  })

  it('拿不到来源应用时整个略过，不留空括号', () => {
    const meta = recordMeta({ ...record, sourceApp: null }, t)
    expect(meta).not.toContain('undefined')
    expect(meta.split(' · ').at(-1)).not.toBe('')
  })
})

describe('本月用量文案', () => {
  const usage: Usage = {
    count: 12,
    inputTokens: 1200,
    outputTokens: 400,
    costUsd: 0.0123,
    unpriced: 0,
  }

  it('还没读到数据时给出等待文案', () => {
    expect(usageLine(null, t)).toContain('正在读取')
  })

  it('显示次数、token 与费用', () => {
    const line = usageLine(usage, t)
    expect(line).toContain('本月 12 次')
    expect(line).toContain('1200 → 400 tokens')
    expect(line).toContain('$0.0123')
  })

  it('有未计价条目时必须如实说出条数', () => {
    // 只报总额会让人以为「这个月就花了这么点」，而实际有一部分没算进去。
    const line = usageLine({ ...usage, unpriced: 3 }, t)
    expect(line).toContain('另有 3 条未计价')
  })

  it('没有未计价条目时不加那句尾巴', () => {
    expect(usageLine(usage, t)).not.toContain('未计价')
  })
})

const day = (d: string, count: number, cost = 0.001, unpriced = 0): DayUsage => ({
  day: d,
  count,
  inputTokens: count * 10,
  outputTokens: count * 4,
  costUsd: cost,
  unpriced,
})

describe('按日柱状图', () => {
  it('按日期升序排列（左边最早、右边最近）', () => {
    const bars = dailyBars([day('2026-10-05', 2), day('2026-10-03', 1), day('2026-10-04', 3)])
    expect(bars.map((b) => b.day)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05'])
  })

  it('比例以窗口内最大值为基准', () => {
    const bars = dailyBars([day('2026-10-01', 5), day('2026-10-02', 10)])
    expect(bars[0].ratio).toBeCloseTo(0.5)
    expect(bars[1].ratio).toBe(1)
  })

  it('全为 0 时不会除零', () => {
    // 分母为 0 会算出 NaN，而 NaN 传进 CSS 高度会让柱子直接消失。
    const bars = dailyBars([day('2026-10-01', 0), day('2026-10-02', 0)])
    expect(bars.every((b) => Number.isFinite(b.ratio) && b.ratio === 0)).toBe(true)
  })

  it('只保留窗口内最近 N 天，而不是最早的 N 天', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      day(`2026-09-${String(i + 1).padStart(2, '0')}`, i + 1),
    )
    const bars = dailyBars(many, 14)
    expect(bars).toHaveLength(14)
    expect(bars.at(-1)?.count).toBe(30)
  })

  it('标签只取月日，不带年份', () => {
    expect(dailyBars([day('2026-10-06', 1)])[0].label).toBe('10-06')
  })

  it('悬浮说明里带日期、次数与费用，未计价要标明', () => {
    const title = dayBarTitle(dailyBars([day('2026-10-06', 3, 0.0021, 2)])[0], t)
    expect(title).toContain('2026-10-06')
    expect(title).toContain('3 次')
    expect(title).toContain('2 条未计价')
  })
})

describe('收藏元信息', () => {
  it('区分单词与句子', () => {
    const base = {
      id: 1,
      createdAt: 0,
      text: 'hello',
      translation: '你好',
      sourceLang: null,
      targetLang: 'zh-CN',
    }
    expect(favoriteMeta({ ...base, kind: 'word' }, t)).toBe('单词 · zh-CN')
    expect(favoriteMeta({ ...base, kind: 'sentence' }, t)).toBe('句子 · zh-CN')
  })
})
