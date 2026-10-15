/**
 * 客户端界面国际化（PRD §8：界面首发简体中文、繁体中文、英文、日文）。
 *
 * 三条设计：
 *
 * 1. **简体中文是源语言。** 其它语言缺哪条就回落哪条——缺一条翻译不该让界面
 *    变成空白或 key。有一条测试要求四种语言的 key 集合**完全一致**，
 *    所以回落只是兜底，不是常态。
 * 2. **语言判定是纯函数**（`resolveLocale`）。`zh-Hant` → 繁体、`zh-Hans` → 简体
 *    这类映射最容易想当然，而想当然的结果是「繁体用户看到简体」。
 * 3. **用一个极小的外部 store**，而不是 React context：客户端有六个独立窗口，
 *    各自 `createRoot`，没有共同的 provider 树；6 个文件都记得包一层 context
 *    才是迟早会漏的做法。
 */

import { useCallback, useSyncExternalStore } from 'react'

import { MESSAGES, type MessageKey } from './messages'

export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'ja'

/** 界面语言的可选项。`system` 之外的值都直接对应一种语言。 */
export const LOCALES: Array<[Locale | 'system', string]> = [
  ['system', '跟随系统'],
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['en', 'English'],
  ['ja', '日本語'],
]

/** 源语言：所有 key 在这里定义，其它语言由它回落。 */
export const SOURCE_LOCALE: Locale = 'zh-CN'

const ALL_LOCALES: Locale[] = ['zh-CN', 'zh-TW', 'en', 'ja']

export type Params = Record<string, string | number>

/**
 * 取文案的函数。纯函数（reducer、格式化器）通过参数接收它，
 * 而不是 import 一个全局——那样它们就测不了了。
 */
export type Translate = (key: MessageKey, params?: Params) => string

/**
 * 设置里的语言值 + 系统语言偏好 → 真正使用的语言。
 *
 * `systemLanguages` 形如 `['zh-Hant-TW', 'en-US']`（`navigator.languages`）。
 */
export function resolveLocale(setting: string, systemLanguages: string[] = []): Locale {
  const wanted = setting.trim()
  // 明选的语言优先；认不出来的值当作「跟随系统」——手改过的配置文件
  // 不该让界面变成一种不存在的语言。
  if (wanted !== '' && wanted !== 'system') {
    const matched = ALL_LOCALES.find((locale) => locale === wanted)
    if (matched) return matched
  }

  for (const raw of systemLanguages) {
    const tag = raw.trim().toLowerCase()
    if (tag === '') continue
    if (tag.startsWith('zh')) {
      // 繁体地区：台湾、香港、澳门，以及显式标注 Hant 的。
      // 只按 `zh` 判断会让繁体用户看到简体，这是最常见的错法。
      const traditional =
        tag.includes('hant') || tag.includes('-tw') || tag.includes('-hk') || tag.includes('-mo')
      return traditional ? 'zh-TW' : 'zh-CN'
    }
    if (tag.startsWith('ja')) return 'ja'
    if (tag.startsWith('en')) return 'en'
  }

  return SOURCE_LOCALE
}

/** 把 `{name}` 换成参数值。没给参数时原样保留——比渲染出 `undefined` 好。 */
function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const template = MESSAGES[locale][key] ?? MESSAGES[SOURCE_LOCALE][key]
  // 连源语言都没有：返回 key 本身，让它在界面上一眼可见（而不是空白）。
  return interpolate(template ?? key, params)
}

// ---------------------------------------------------------------- 外部 store

let current: Locale = SOURCE_LOCALE
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(next: Locale): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 组件里这样用：`const t = useT()`。
 *
 * 它同时订阅语言变化——设置窗改了语言，已经开着的浮窗会立刻跟着变，
 * 不需要重启（与主题走同一套广播）。
 */
export function useT(): (key: MessageKey, params?: Params) => string {
  const locale = useSyncExternalStore(
    subscribe,
    () => current,
    () => SOURCE_LOCALE,
  )
  return useCallback((key: MessageKey, params?: Params) => translate(locale, key, params), [locale])
}

/** 非组件代码（事件回调、纯函数）用这个：`tFor(getLocale())`。 */
export function tFor(locale: Locale): Translate {
  return (key, params) => translate(locale, key, params)
}
