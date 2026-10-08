import { HTML_LANG, LOCALES, SITE_URL } from '../config'
import { getSeo } from '../content'
import type { Locale } from '../content/types'

/**
 * 运行时的 head 管理：切换语言后更新 title / description / canonical / hreflang / OG。
 * 构建时还会为每种语言产出静态 HTML（见 vite.config.ts 的 locale-html 插件），
 * 这样爬虫和禁用 JS 的访客也能拿到正确的元信息。
 */

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.append(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string, hrefLang?: string) {
  const selector = hrefLang
    ? `link[rel="${rel}"][hreflang="${hrefLang}"]`
    : `link[rel="${rel}"]:not([hreflang])`
  let el = document.head.querySelector<HTMLLinkElement>(selector)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    if (hrefLang) el.hreflang = hrefLang
    document.head.append(el)
  }
  el.href = href
}

export function applySeo(locale: Locale) {
  const seo = getSeo(locale)
  const url = `${SITE_URL}/${locale}/`

  document.documentElement.lang = HTML_LANG[locale] ?? locale
  document.title = seo.title

  upsertMeta('name', 'description', seo.description)
  upsertLink('canonical', url)

  for (const alt of LOCALES) {
    upsertLink('alternate', `${SITE_URL}/${alt}/`, alt)
  }
  upsertLink('alternate', `${SITE_URL}/${LOCALES[0]}/`, 'x-default')

  upsertMeta('property', 'og:type', 'website')
  upsertMeta('property', 'og:site_name', 'umuo')
  upsertMeta('property', 'og:title', seo.title)
  upsertMeta('property', 'og:description', seo.description)
  upsertMeta('property', 'og:url', url)
  upsertMeta('property', 'og:locale', seo.ogLocale)

  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', seo.title)
  upsertMeta('name', 'twitter:description', seo.description)
}
