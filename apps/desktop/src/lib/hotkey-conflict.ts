/**
 * 快捷键冲突检查（PRD §7.2：「录制时检查系统与已知常用 App 的冲突并提示」）。
 *
 * 这里只做**静态检查**：明显不成立的组合、与我们自己重复、命中已知的系统快捷键。
 * 真正"被别的应用占着"这件事无法预先知道——macOS 只在注册时**静默拒绝**，
 * 所以那一半靠 Rust 侧记录注册失败（`hotkeyFailures`）再回到界面。
 */

import { doubleTapsOverlap, parseDoubleTap } from './hotkey-format'

export type ConflictKind = 'no-modifier' | 'duplicate' | 'system'

export interface Conflict {
  kind: ConflictKind
  message: string
  /** 撞上的是谁：重复时是另一个功能的名字，系统冲突时是系统功能名。供界面按语言重组句子。 */
  subject?: string
}

/**
 * 已知的系统/常用快捷键。
 *
 * 抢走它们不会报错，只会让用户觉得"某个功能突然坏了"——
 * 而那个功能通常在别的应用里，他根本不会想到是我们抢的。
 */
const RAW_SYSTEM_SHORTCUTS: Record<string, string> = {
  'cmd+space': 'Spotlight 搜索',
  'cmd+tab': '切换应用',
  'cmd+shift+3': '截取整个屏幕',
  'cmd+shift+4': '截取屏幕区域',
  'cmd+shift+5': '屏幕录制',
  'ctrl+up': '调度中心',
  'ctrl+down': '应用窗口',
  'ctrl+left': '移到左边的空间',
  'ctrl+right': '移到右边的空间',
  'cmd+q': '退出当前应用',
  'cmd+shift+q': '退出登录',
  'cmd+option+esc': '强制退出',
  'ctrl+cmd+q': '锁定屏幕',
}

/**
 * 查表用的表：键在**第一次查询时**归一化。
 *
 * 两个坑都在这里踩过：
 * ① 表里写成 `cmd+shift+4` 而候选归一化成 `shift+cmd+4`，就永远匹配不上——
 *    一个静默失效的检查；
 * ② 如果在模块顶层直接算，`normalizeHotkey` 会读到还没初始化的别名常量（TDZ）。
 * 所以写成惰性构建：只算一次，且不依赖模块初始化顺序。
 */
let systemLookup: Record<string, string> | null = null

function systemShortcuts(): Record<string, string> {
  systemLookup ??= Object.fromEntries(
    Object.entries(RAW_SYSTEM_SHORTCUTS).map(([combo, name]) => [normalizeHotkey(combo), name]),
  )
  return systemLookup
}

const MODIFIER_ALIASES: Record<string, string> = {
  option: 'alt',
  opt: 'alt',
  command: 'cmd',
  cmd: 'cmd',
  meta: 'cmd',
  super: 'cmd',
  control: 'ctrl',
  ctrl: 'ctrl',
  shift: 'shift',
}

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'cmd']

/**
 * 归一化：修饰键统一别名并**按固定顺序**排列，主键小写。
 *
 * 必须归一化才能比较——`Option+D`、`Alt+D`、`alt+d` 是同一个键；
 * 不归一化的话重复快捷键会被放过去，而用户为它困惑一整天。
 */
export function normalizeHotkey(input: string): string {
  const parts = input
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '')
  if (parts.length === 0) return ''

  const modifiers = new Set<string>()
  const keys: string[] = []
  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part]
    if (alias) modifiers.add(alias)
    else keys.push(part)
  }

  const ordered = MODIFIER_ORDER.filter((name) => modifiers.has(name))
  return [...ordered, ...keys].join('+')
}

/** 「真正的」修饰键：只有 Shift 不算——它不改变按键落到哪里。 */
function hasRealModifier(normalized: string): boolean {
  return ['ctrl', 'alt', 'cmd'].some((name) => normalized.split('+').includes(name))
}

export function checkHotkey(
  candidate: string,
  others: Array<{ label: string; value: string }>,
): Conflict | null {
  const normalized = normalizeHotkey(candidate)
  // 留空 = 用默认值（Rust 侧解析失败时会回落到内置默认），不算冲突。
  if (normalized === '') return null

  // 连按两下修饰键（⌃⌃）：本来就只有修饰键，不做「缺修饰键」检查；只查与别的功能是否撞上。
  const tap = parseDoubleTap(candidate)
  if (tap) {
    const clash = others.find((other) => {
      const theirs = parseDoubleTap(other.value)
      return theirs !== null && doubleTapsOverlap(tap, theirs)
    })
    return clash
      ? { kind: 'duplicate', message: `与「${clash.label}」重复`, subject: clash.label }
      : null
  }

  if (!hasRealModifier(normalized)) {
    // 没有真正的修饰键的全局热键会**吞掉**所有应用里的这个按键。
    return {
      kind: 'no-modifier',
      message: '至少要有一个 ⌃ / ⌥ / ⌘ 修饰键，否则这个键在任何应用里都会被抢走',
    }
  }

  const clash = others.find((other) => normalizeHotkey(other.value) === normalized)
  if (clash) {
    return { kind: 'duplicate', message: `与「${clash.label}」重复`, subject: clash.label }
  }

  const system = systemShortcuts()[normalized]
  if (system) {
    return {
      kind: 'system',
      message: `系统已经用它做「${system}」，抢过来会让那个功能失效`,
      subject: system,
    }
  }

  return null
}
