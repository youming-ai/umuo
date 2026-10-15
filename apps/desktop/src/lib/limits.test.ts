import { describe, expect, it } from 'vitest'

import { translate } from './i18n'
import { limitFor, limitSummary, parseLimit, setLimit, spendFor } from './limits'

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('zh-CN', key, params)

const limit = (providerId: string, limitUsd: number) => ({ providerId, limitUsd })
const spend = (providerId: string, costUsd: number) => ({
  providerId,
  count: 1,
  inputTokens: 10,
  outputTokens: 5,
  costUsd,
  unpriced: 0,
})

describe('读取上限', () => {
  it('没设过的供应商返回 null，而不是 0', () => {
    // 0 表示「一分钱也不许花」，与「没设上限」完全相反。
    expect(limitFor([], 'openai')).toBeNull()
    expect(limitFor([limit('deepseek', 5)], 'openai')).toBeNull()
  })

  it('设过的能取回来', () => {
    expect(limitFor([limit('openai', 5)], 'openai')).toBe(5)
  })
})

describe('设置与清除上限', () => {
  it('新增一条', () => {
    expect(setLimit([], 'openai', 5)).toEqual([limit('openai', 5)])
  })

  it('覆盖同一条而不是产生第二条', () => {
    const result = setLimit([limit('openai', 5)], 'openai', 9)
    expect(result).toHaveLength(1)
    expect(result[0].limitUsd).toBe(9)
  })

  it('传 null 是清除，而不是记成 0', () => {
    // 记成 0 会把「取消上限」变成「禁止花钱」，意思正好相反。
    expect(setLimit([limit('openai', 5)], 'openai', null)).toEqual([])
  })

  it('0 是一个有效的上限（临时停用这个供应商）', () => {
    expect(setLimit([], 'openai', 0)).toEqual([limit('openai', 0)])
    expect(limitFor([limit('openai', 0)], 'openai')).toBe(0)
  })

  it('负数被夹到 0', () => {
    expect(setLimit([], 'openai', -3)[0].limitUsd).toBe(0)
  })

  it('不修改原数组', () => {
    const original = [limit('openai', 5)]
    setLimit(original, 'deepseek', 1)
    expect(original).toHaveLength(1)
  })
})

describe('解析输入框', () => {
  it('空串表示清除而不是 0', () => {
    // Number('') 是 0，直接用它会让清空输入框变成「禁止花钱」。
    expect(parseLimit('')).toBeNull()
    expect(parseLimit('  ')).toBeNull()
  })

  it('非数字也当作清除，而不是崩掉', () => {
    expect(parseLimit('abc')).toBeNull()
  })

  it('正常数字原样通过，负数夹到 0', () => {
    expect(parseLimit('5.5')).toBe(5.5)
    expect(parseLimit('-2')).toBe(0)
  })
})

describe('本月花费', () => {
  it('没有记录的供应商是 0', () => {
    expect(spendFor([], 'openai')).toBe(0)
  })

  it('按供应商取，不会串到别人身上', () => {
    expect(spendFor([spend('openai', 1.5), spend('deepseek', 9)], 'openai')).toBe(1.5)
  })
})

describe('摘要', () => {
  it('没设上限时明确写「不限」', () => {
    expect(limitSummary(null, 1.2345, t)).toContain('不限')
  })

  it('超限时写出来，而不是让人自己比大小', () => {
    expect(limitSummary(5, 6.5, t)).toContain('已超限')
  })

  it('正好花到上限也算超限（与 Rust 侧 >= 的口径一致）', () => {
    expect(limitSummary(5, 5, t)).toContain('已超限')
  })

  it('没超限时不写那句话', () => {
    expect(limitSummary(5, 1, t)).not.toContain('已超限')
  })
})
