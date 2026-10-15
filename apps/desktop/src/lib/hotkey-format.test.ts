import { describe, expect, it } from 'vitest'

import {
  comboFromKey,
  createDoubleTapRecorder,
  doubleTapsOverlap,
  hotkeyParts,
  type KeyLike,
  parseDoubleTap,
} from './hotkey-format'

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('录键：按键事件 → 快捷键字符串', () => {
  it('取物理键位，不受 ⌥ 组合出的字符影响（⌥P 不会录成 π）', () => {
    expect(comboFromKey(key('KeyP', { altKey: true }))).toEqual({ kind: 'combo', value: 'Alt+P' })
  })

  it('修饰键按固定顺序写在前面', () => {
    expect(
      comboFromKey(key('Digit1', { metaKey: true, shiftKey: true, ctrlKey: true, altKey: true })),
    ).toEqual({ kind: 'combo', value: 'Ctrl+Alt+Shift+Cmd+1' })
  })

  it('只按了修饰键时继续等主键', () => {
    expect(comboFromKey(key('AltLeft', { altKey: true }))).toEqual({ kind: 'waiting' })
    expect(comboFromKey(key('MetaRight', { metaKey: true }))).toEqual({ kind: 'waiting' })
  })

  it('只带 ⇧ 或没有修饰键的普通键不算快捷键（会吞掉打字）', () => {
    expect(comboFromKey(key('KeyA'))).toEqual({ kind: 'waiting' })
    expect(comboFromKey(key('KeyA', { shiftKey: true }))).toEqual({ kind: 'waiting' })
  })

  it('功能键可以单独作快捷键', () => {
    expect(comboFromKey(key('F5'))).toEqual({ kind: 'combo', value: 'F5' })
  })

  it('录不了的键明确说出来', () => {
    expect(comboFromKey(key('NumpadEnter', { altKey: true }))).toEqual({ kind: 'unsupported' })
  })
})

describe('显示：快捷键字符串 → 键帽', () => {
  it('修饰键画成符号', () => {
    expect(hotkeyParts('Alt+Shift+T')).toEqual(['⌥', '⇧', 'T'])
    expect(hotkeyParts('Ctrl+Cmd+Space')).toEqual(['⌃', '⌘', 'Space'])
  })

  it('兼容手写配置里的别名与大小写', () => {
    expect(hotkeyParts('option+command+keyo')).toEqual(['⌥', '⌘', 'O'])
    expect(hotkeyParts('Alt+ArrowUp')).toEqual(['⌥', '↑'])
  })
})

describe('连按两下修饰键', () => {
  it('解析与 Rust 侧同一种写法', () => {
    expect(parseDoubleTap('Ctrl Ctrl')).toEqual({ kind: 'ctrl', side: null })
    expect(parseDoubleTap('RightCmd rightcmd')).toEqual({ kind: 'cmd', side: 'right' })
    expect(parseDoubleTap('Alt+D')).toBeNull()
    expect(parseDoubleTap('Ctrl Alt')).toBeNull()
  })

  it('「⌃⌃」与「右⌃⌃」会被同一下连按触发，算重叠', () => {
    expect(doubleTapsOverlap({ kind: 'ctrl', side: null }, { kind: 'ctrl', side: 'right' })).toBe(
      true,
    )
    expect(doubleTapsOverlap({ kind: 'ctrl', side: 'left' }, { kind: 'ctrl', side: 'right' })).toBe(
      false,
    )
    expect(doubleTapsOverlap({ kind: 'ctrl', side: null }, { kind: 'alt', side: null })).toBe(false)
  })

  it('显示成两个键帽，右侧带前缀', () => {
    expect(hotkeyParts('Ctrl Ctrl')).toEqual(['⌃', '⌃'])
    expect(hotkeyParts('RightCmd RightCmd', '右')).toEqual(['右⌘', '右⌘'])
  })

  it('录键：左 ⌃ 快按两下录成「Ctrl Ctrl」', () => {
    const recorder = createDoubleTapRecorder()
    recorder.down('ControlLeft', 0)
    expect(recorder.up('ControlLeft', 60)).toBeNull()
    recorder.down('ControlLeft', 200)
    expect(recorder.up('ControlLeft', 260)).toBe('Ctrl Ctrl')
  })

  it('录键：右 ⌘ 录成只认右侧', () => {
    const recorder = createDoubleTapRecorder()
    recorder.down('MetaRight', 0)
    recorder.up('MetaRight', 50)
    recorder.down('MetaRight', 150)
    expect(recorder.up('MetaRight', 200)).toBe('RightCmd RightCmd')
  })

  it('录键：中间按了别的键、或按太久、或太慢，都不算', () => {
    const interrupted = createDoubleTapRecorder()
    interrupted.down('AltLeft', 0)
    interrupted.up('AltLeft', 50)
    interrupted.other()
    interrupted.down('AltLeft', 150)
    expect(interrupted.up('AltLeft', 200)).toBeNull()

    const held = createDoubleTapRecorder()
    held.down('AltLeft', 0)
    held.up('AltLeft', 400)
    held.down('AltLeft', 450)
    expect(held.up('AltLeft', 500)).toBeNull()

    const slow = createDoubleTapRecorder()
    slow.down('AltLeft', 0)
    slow.up('AltLeft', 50)
    slow.down('AltLeft', 800)
    expect(slow.up('AltLeft', 850)).toBeNull()
  })
})
