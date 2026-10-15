/**
 * 快捷键字符串与按键事件之间的转换（录键器用）。
 *
 * 存储格式沿用全局快捷键插件认的写法：`Ctrl+Alt+Shift+Cmd+P`，修饰键在前、主键在最后。
 * 主键一律取 `KeyboardEvent.code`（物理键位）而不是 `key`：按住 ⌥ 时 `key` 会变成组合出来的字符
 * （⌥P 是「π」），用它只会录出一串插件不认识的东西。
 */

/** 录键器能产出的主键名。Rust 侧有一条测试逐个确认插件都能解析（settings.rs）。 */
export const RECORDABLE_KEYS: readonly string[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  'Space',
  'Enter',
  'Tab',
  'Comma',
  'Period',
  'Slash',
  'Semicolon',
  'Quote',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Minus',
  'Equal',
  'Backquote',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]

/** 录键器关心的那部分按键事件（便于测试时手写）。 */
export interface KeyLike {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** `KeyboardEvent.code` → 存储用的主键名；不支持的键返回 null。 */
function mainKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  return RECORDABLE_KEYS.includes(code) ? code : null
}

export type RecordResult =
  | { kind: 'combo'; value: string }
  /** 只按了修饰键，还在等主键。 */
  | { kind: 'waiting' }
  /** 这个键录不了（例如数字小键盘、媒体键）。 */
  | { kind: 'unsupported' }

/**
 * 把一次按下变成快捷键字符串。至少要有 ⌃ / ⌥ / ⌘ 之一（只带 ⇧ 不算），
 * 功能键 F1–F12 例外——它们本来就不会和打字冲突。
 */
export function comboFromKey(event: KeyLike): RecordResult {
  const key = mainKey(event.code)
  if (key === null) {
    return /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code)
      ? { kind: 'waiting' }
      : { kind: 'unsupported' }
  }
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey ? 'Cmd' : null,
  ].filter((m): m is string => m !== null)
  const real = event.ctrlKey || event.altKey || event.metaKey
  if (!real && !/^F\d+$/.test(key)) return { kind: 'waiting' }
  return { kind: 'combo', value: [...modifiers, key].join('+') }
}

const MODIFIER_SYMBOLS: Record<string, string> = {
  CTRL: '⌃',
  CONTROL: '⌃',
  ALT: '⌥',
  OPTION: '⌥',
  SHIFT: '⇧',
  CMD: '⌘',
  COMMAND: '⌘',
  SUPER: '⌘',
}

const KEY_SYMBOLS: Record<string, string> = {
  SPACE: 'Space',
  ENTER: '↩',
  TAB: '⇥',
  COMMA: ',',
  PERIOD: '.',
  SLASH: '/',
  SEMICOLON: ';',
  QUOTE: "'",
  BRACKETLEFT: '[',
  BRACKETRIGHT: ']',
  BACKSLASH: '\\',
  MINUS: '-',
  EQUAL: '=',
  BACKQUOTE: '`',
  ARROWUP: '↑',
  ARROWDOWN: '↓',
  ARROWLEFT: '←',
  ARROWRIGHT: '→',
}

/**
 * 显示用：`Alt+Shift+T` → `["⌥", "⇧", "T"]`；连按 `RightCmd RightCmd` → `["右⌘", "右⌘"]`。
 * `rightLabel` 由调用方按界面语言给（「右」/「R」）。
 */
export function hotkeyParts(value: string, rightLabel = 'R'): string[] {
  const tap = parseDoubleTap(value)
  if (tap) {
    const symbol = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' }[tap.kind]
    const cap = tap.side === 'right' ? `${rightLabel}${symbol}` : symbol
    return [cap, cap]
  }
  return value
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token !== '')
    .map((token) => {
      const upper = token.toUpperCase()
      if (MODIFIER_SYMBOLS[upper]) return MODIFIER_SYMBOLS[upper]
      if (KEY_SYMBOLS[upper]) return KEY_SYMBOLS[upper]
      if (/^KEY[A-Z]$/.test(upper)) return upper.slice(3)
      if (/^DIGIT[0-9]$/.test(upper)) return upper.slice(5)
      return token.length === 1 ? upper : token
    })
}

/* ------------------------------------------------------------------ 连按两下修饰键 */

export type ModKind = 'ctrl' | 'alt' | 'shift' | 'cmd'

/** 一个连按快捷键：哪种修饰键，限定哪一侧（null = 左右都算）。与 Rust 侧 `umuo_core::hotkey` 同一规则。 */
export interface DoubleTapSpec {
  kind: ModKind
  side: 'left' | 'right' | null
}

const KIND_NAMES: Record<string, ModKind> = {
  CTRL: 'ctrl',
  CONTROL: 'ctrl',
  ALT: 'alt',
  OPTION: 'alt',
  SHIFT: 'shift',
  CMD: 'cmd',
  COMMAND: 'cmd',
  SUPER: 'cmd',
}

/** `Ctrl Ctrl` / `RightCmd RightCmd` → 连按规格；不是连按格式返回 null。 */
export function parseDoubleTap(value: string): DoubleTapSpec | null {
  const tokens = value.trim().split(/\s+/)
  if (tokens.length !== 2 || tokens[0].toUpperCase() !== tokens[1].toUpperCase()) return null
  let name = tokens[0].toUpperCase()
  let side: DoubleTapSpec['side'] = null
  if (name.startsWith('LEFT')) {
    side = 'left'
    name = name.slice(4)
  } else if (name.startsWith('RIGHT')) {
    side = 'right'
    name = name.slice(5)
  }
  const kind = KIND_NAMES[name]
  return kind ? { kind, side } : null
}

/** 两个连按快捷键是否会被同一下连按触发（「⌃⌃」包含了「右⌃⌃」）。 */
export function doubleTapsOverlap(a: DoubleTapSpec, b: DoubleTapSpec): boolean {
  return a.kind === b.kind && (a.side === null || b.side === null || a.side === b.side)
}

const MODIFIER_CODES: Record<string, { name: string; side: 'left' | 'right' }> = {
  ControlLeft: { name: 'Ctrl', side: 'left' },
  ControlRight: { name: 'Ctrl', side: 'right' },
  AltLeft: { name: 'Alt', side: 'left' },
  AltRight: { name: 'Alt', side: 'right' },
  ShiftLeft: { name: 'Shift', side: 'left' },
  ShiftRight: { name: 'Shift', side: 'right' },
  MetaLeft: { name: 'Cmd', side: 'left' },
  MetaRight: { name: 'Cmd', side: 'right' },
}

/** 录键时的判定参数，与 Rust 侧一致：每下按住不超过 250ms，两下间隔不超过 350ms。 */
const MAX_PRESS_MS = 250
const MAX_GAP_MS = 350

/**
 * 录键器里的连按判定（与 Rust 侧状态机同一套规则的简化版）。
 * 左侧修饰键录成「左右都算」（`Ctrl Ctrl`），右侧录成只认右侧（`RightCmd RightCmd`）——
 * 右侧单独成键是有意义的（例如右 ⌘ 连按），左侧则是大多数人的默认手位。
 */
export function createDoubleTapRecorder() {
  let held = new Set<string>()
  let press: { code: string; at: number } | null = null
  let lastTap: { code: string; at: number } | null = null

  const reset = () => {
    press = null
    lastTap = null
  }

  return {
    down(code: string, at: number): void {
      if (!MODIFIER_CODES[code]) return
      if (held.has(code)) return
      if (held.size > 0) {
        reset()
      } else {
        if (lastTap && lastTap.code !== code) lastTap = null
        press = { code, at }
      }
      held = new Set([...held, code])
    },
    /** 松开一个修饰键；凑成连按就返回要保存的快捷键字符串。 */
    up(code: string, at: number): string | null {
      const info = MODIFIER_CODES[code]
      if (!info) return null
      held = new Set([...held].filter((c) => c !== code))
      const current = press
      press = null
      if (!current || current.code !== code || at - current.at > MAX_PRESS_MS) {
        lastTap = null
        return null
      }
      if (lastTap && lastTap.code === code && current.at - lastTap.at <= MAX_GAP_MS) {
        lastTap = null
        const name = info.side === 'right' ? `Right${info.name}` : info.name
        return `${name} ${name}`
      }
      lastTap = { code, at }
      return null
    },
    /** 按了别的键：打断。 */
    other: reset,
  }
}
