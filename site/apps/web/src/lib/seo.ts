import { HTML_LANG, SITE_URL } from '../config'
import { getSeo } from '../content'
import type { Locale } from '../content/types'

/**
 * 每种语言的 head：title / description / canonical / OG / Twitter Card，只在这里定义一次。
 * 构建时 vite.config.ts 的 locale-html 插件把它写进各语言的预渲染 HTML；
 * 运行时切换语言后由 applySeo 就地更新。地址只有 `/`，所以 canonical 恒为根路径，也没有 hreflang 备选地址。
 */
export function headTags(locale: Locale) {
  const seo = getSeo(locale)
  const url = `${SITE_URL}/`
  return {
    title: seo.title,
    canonical: url,
    meta: [
      ['name', 'description', seo.description],
      ['property', 'og:type', 'website'],
      ['property', 'og:site_name', 'umuo'],
      ['property', 'og:title', seo.title],
      ['property', 'og:description', seo.description],
      ['property', 'og:url', url],
      ['property', 'og:locale', seo.ogLocale],
      // 没有 og:image，不能声明大图卡片（见 config.ts 的说明）
      ['name', 'twitter:card', 'summary'],
      ['name', 'twitter:title', seo.title],
      ['name', 'twitter:description', seo.description],
    ] as Array<[attr: 'name' | 'property', key: string, content: string]>,
  }
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.append(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.append(el)
  }
  el.href = href
}

/** 运行时的 head 管理：切换语言后更新 `<html lang>` 与 headTags 里的全部标签 */
export function applySeo(locale: Locale) {
  const head = headTags(locale)
  document.documentElement.lang = HTML_LANG[locale] ?? locale
  document.title = head.title
  upsertLink('canonical', head.canonical)
  for (const [attr, key, content] of head.meta) upsertMeta(attr, key, content)
}
