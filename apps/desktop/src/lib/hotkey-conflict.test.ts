import { describe, expect, it } from 'vitest'

import { checkHotkey, normalizeHotkey } from './hotkey-conflict'

describe('快捷键归一化', () => {
  it('修饰键别名与顺序不影响判定', () => {
    // 不归一化的话重复快捷键会被放过去，而用户为它困惑一整天。
    expect(normalizeHotkey('Option+D')).toBe('alt+d')
    expect(normalizeHotkey('alt+d')).toBe('alt+d')
    expect(normalizeHotkey('Command+Shift+T')).toBe('shift+cmd+t')
    expect(normalizeHotkey('Shift+Cmd+T')).toBe('shift+cmd+t')
    expect(normalizeHotkey('  Option + D  ')).toBe('alt+d')
  })

  it('大小写与多余空格都无关', () => {
    expect(normalizeHotkey('ALT+SHIFT+C')).toBe(normalizeHotkey('alt + shift + c'))
  })

  it('空输入归一化为空串', () => {
    expect(normalizeHotkey('')).toBe('')
    expect(normalizeHotkey('   ')).toBe('')
  })
})

describe('冲突检查', () => {
  const others = [
    { label: '划词翻译', value: 'Alt+D' },
    { label: '截图 OCR', value: 'Alt+S' },
  ]

  it('干净的组合没有冲突', () => {
    expect(checkHotkey('Alt+R', others)).toBeNull()
    expect(checkHotkey('Cmd+Shift+J', others)).toBeNull()
  })

  it('留空不算冲突（它会回落到默认值）', () => {
    expect(checkHotkey('', others)).toBeNull()
  })

  it('与自己其它功能重复会被认出来，且别名无关', () => {
    // `Option+D` 与 `Alt+D` 是同一个键。
    const conflict = checkHotkey('Option+D', others)
    expect(conflict?.kind).toBe('duplicate')
    expect(conflict?.message).toContain('划词翻译')
  })

  it('没有真正的修饰键会被拦下', () => {
    // 这种全局热键会吞掉所有应用里的这个按键——最危险的一种配置。
    expect(checkHotkey('D', others)?.kind).toBe('no-modifier')
    expect(checkHotkey('Shift+D', others)?.kind).toBe('no-modifier')
  })

  it('命中已知系统快捷键会说明那个功能是谁的', () => {
    const spotlight = checkHotkey('Cmd+Space', others)
    expect(spotlight?.kind).toBe('system')
    expect(spotlight?.message).toContain('Spotlight')

    expect(checkHotkey('Cmd+Shift+4', others)?.message).toContain('截取')
  })

  it('客户端自带的默认快捷键全部通过检查', () => {
    // 这条是给将来的人用的：新增默认快捷键时如果撞了系统键或彼此重复，这里会亮。
    const defaults = ['Alt+D', 'Alt+A', 'Alt+Shift+T', 'Alt+S', 'Alt+C', 'Alt+Shift+C', 'Alt+R']
    for (const candidate of defaults) {
      const others2 = defaults
        .filter((value) => value !== candidate)
        .map((value) => ({ label: value, value }))
      expect(checkHotkey(candidate, others2), `${candidate} 不该有冲突`).toBeNull()
    }
  })
})

describe('连按两下修饰键的冲突检查', () => {
  it('连按本身只有修饰键，不报「缺修饰键」', () => {
    expect(checkHotkey('Ctrl Ctrl', [])).toBeNull()
  })

  it('与别的功能的连按重叠时报重复', () => {
    expect(checkHotkey('Ctrl Ctrl', [{ label: '划词翻译', value: 'RightCtrl RightCtrl' }])).toEqual(
      {
        kind: 'duplicate',
        message: '与「划词翻译」重复',
        subject: '划词翻译',
      },
    )
    expect(checkHotkey('Alt Alt', [{ label: '划词翻译', value: 'Ctrl Ctrl' }])).toBeNull()
  })
})
