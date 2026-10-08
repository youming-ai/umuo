import { HTML_LANG, SITE_URL } from '../config'
import type { Locale } from '../content/types'
import { getPageSeo, pagePath, type SitePage } from './pages'

/**
 * 运行时的 head 管理：切换语言后更新 title / description / OG。
 * 地址只有 `/`，所以 canonical 恒为根路径，也没有 hreflang 备选地址。
 * 构建时每种语言的 head 已写进各自的预渲染 HTML（见 vite.config.ts 的 locale-html 插件）。
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

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.append(el)
  }
  el.href = href
}

export function applySeo(locale: Locale, page: SitePage = 'home') {
  const seo = getPageSeo(locale, page)
  const url = `${SITE_URL}${pagePath(locale, page)}`

  document.documentElement.lang = HTML_LANG[locale] ?? locale
  document.title = seo.title

  upsertMeta('name', 'description', seo.description)
  upsertLink('canonical', url)

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
