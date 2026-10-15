import { describe, expect, it } from 'vitest'

import { resolveTheme, THEME_CHOICES } from './theme'

describe('主题解析（PRD §7.3）', () => {
  it('明选的主题不理会系统偏好', () => {
    // 用户明选了浅色，系统是深色——听用户的。
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('跟随系统时按系统偏好走', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('高对比度映射到令牌里真实存在的主题名', () => {
    // 令牌里是 `html[data-theme="high-contrast"]`（连字符），不是 camelCase——
    // 写错了不会报错，只会静默回落成默认主题。
    expect(resolveTheme('highContrast', true)).toBe('high-contrast')
    expect(resolveTheme('highContrast', false)).toBe('high-contrast')
  })

  it('认不出来的值回落跟随系统，而不是让界面变白', () => {
    // 手改过的设置文件、或未来版本写进来的值。
    expect(resolveTheme('', true)).toBe('dark')
    expect(resolveTheme('nonsense', false)).toBe('light')
    expect(resolveTheme(undefined as unknown as string, true)).toBe('dark')
  })

  it('每个选项都能解析出一个结果', () => {
    for (const [id] of THEME_CHOICES) {
      for (const prefersDark of [true, false]) {
        expect(['light', 'dark', 'high-contrast']).toContain(resolveTheme(id, prefersDark))
      }
    }
  })

  it('选项列表覆盖 PRD 要的三种，并多一个高对比度', () => {
    const ids = THEME_CHOICES.map(([id]) => id)
    expect(ids).toContain('light')
    expect(ids).toContain('dark')
    expect(ids).toContain('system')
    // PRD §7.3 只要求前三种；高对比度是 §8 可访问性要求，属于额外提供。
    expect(ids).toContain('highContrast')
  })
})
