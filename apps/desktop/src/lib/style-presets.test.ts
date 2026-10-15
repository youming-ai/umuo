import { describe, expect, it } from 'vitest'
import { translate } from './i18n'
import type { CustomStyle } from './ipc'
import {
  newCustomStyle,
  parseTemperature,
  presetSummary,
  removeStyle,
  upsertStyle,
} from './style-presets'

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('zh-CN', key, params)

const style = (id: string, overrides: Partial<CustomStyle> = {}): CustomStyle => ({
  id,
  label: id,
  instruction: '简短。',
  temperature: 0.2,
  fewShot: [],
  explain: false,
  ...overrides,
})

describe('新建预设', () => {
  it('id 带 custom- 前缀，不会撞上内置风格', () => {
    // 内置 id 是 standard / academic 这类词，而且被 Rust 侧列为保留字。
    expect(newCustomStyle(1).id).toMatch(/^custom-/)
  })

  it('同一个时间戳生成同一个 id，不同时间戳不同', () => {
    expect(newCustomStyle(1).id).toBe(newCustomStyle(1).id)
    expect(newCustomStyle(1).id).not.toBe(newCustomStyle(2).id)
  })

  it('默认温度是温和的 0.2，而不是 0 或 1', () => {
    expect(newCustomStyle(1).temperature).toBe(0.2)
  })
})

describe('增删改', () => {
  it('新 id 追加到末尾', () => {
    const list = upsertStyle([style('a')], style('b'))
    expect(list.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('已有 id 就覆盖，不产生第二条', () => {
    const list = upsertStyle([style('a'), style('b')], style('a', { label: '改过' }))
    expect(list).toHaveLength(2)
    expect(list[0].label).toBe('改过')
  })

  it('不改动原数组（设置页要靠不可变更新触发重渲染）', () => {
    const original = [style('a')]
    upsertStyle(original, style('b'))
    expect(original).toHaveLength(1)
  })

  it('删除按 id 精确匹配', () => {
    const list = removeStyle([style('a'), style('b')], 'a')
    expect(list.map((s) => s.id)).toEqual(['b'])
  })

  it('删除不存在的 id 是无操作，不报错', () => {
    const list = [style('a')]
    expect(removeStyle(list, 'nope')).toHaveLength(1)
  })
})

describe('摘要', () => {
  it('显示温度、示例数与解释开关', () => {
    const summary = presetSummary(
      style('a', { fewShot: [{ source: 'a', target: 'b' }], explain: true }),
      t,
    )
    expect(summary).toContain('温度 0.2')
    expect(summary).toContain('1 个示例')
    expect(summary).toContain('附解释')
  })

  it('没填风格指令时明确说出来', () => {
    // 否则用户会以为保存失败了——列表里看着像一条空预设。
    expect(presetSummary(style('a', { instruction: '  ' }), t)).toContain('未填风格指令')
  })

  it('没有示例与解释时就不提它们', () => {
    const summary = presetSummary(style('a'), t)
    expect(summary).not.toContain('示例')
    expect(summary).not.toContain('解释')
  })
})

describe('温度解析', () => {
  it('清空输入框时回到默认值，而不是 0', () => {
    // Number('') === 0，直接用它会让用户清空时温度悄悄变成最保守的 0。
    expect(parseTemperature('')).toBe(0.2)
    expect(parseTemperature('abc')).toBe(0.2)
  })

  it('越界值夹回范围', () => {
    expect(parseTemperature('9')).toBe(2)
    expect(parseTemperature('-1')).toBe(0)
  })

  it('正常值原样通过', () => {
    expect(parseTemperature('0.7')).toBeCloseTo(0.7)
  })
})
