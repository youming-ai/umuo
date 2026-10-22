import { LOCALES } from '../config'
import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'
import type { Locale, SeoContent, SiteContent } from './types'
import { zhCn } from './zh-cn'
import { zhTw } from './zh-tw'

/** 语言 → 内容。新增语言时这里少一个键就编译不过。 */
const CONTENT: Record<Locale, SiteContent> = {
  'zh-cn': zhCn,
  'zh-tw': zhTw,
  en,
  ja,
  ko,
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

export function getContent(locale: Locale): SiteContent {
  return CONTENT[locale]
}

export function getSeo(locale: Locale): SeoContent {
  return CONTENT[locale].seo
}

export type { Locale, SiteContent }
export { LOCALES }
