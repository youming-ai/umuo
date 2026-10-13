import { getContent, getSeo } from '../content'
import type { Locale } from '../content/types'

/**
 * 站点页面清单：首页 `/`，以及定价 `/pricing`、服务条款 `/terms`、隐私政策 `/privacy`。语言不进 URL：
 * 构建时每种语言预渲染一份 `dist/<locale>/[<page>/]index.html`，由 Worker 按 cookie / 浏览器语言挑一份返回。
 * 加页面从这里开始（worker/src/locale.ts 的 PAGES 也要同步）。
 */
export const SITE_PAGES = ['home', 'pricing', 'terms', 'privacy'] as const
export type SitePage = (typeof SITE_PAGES)[number]
export type LegalPage = 'terms' | 'privacy'

/** `/terms`、`/en/terms/` → 'terms'；其余一律算首页 */
export function pageFromPath(pathname: string): SitePage {
  const slug = pathname.split('/').filter(Boolean).at(-1) ?? ''
  return (SITE_PAGES as readonly string[]).includes(slug) ? (slug as SitePage) : 'home'
}

/** 对外的页面地址：不带语言前缀 */
export function pagePath(_locale: Locale, page: SitePage = 'home'): string {
  return page === 'home' ? '/' : `/${page}`
}

/** 预渲染产物在 dist 里的目录（内部文件，访客看不到这个路径） */
export function localeDir(locale: Locale, page: SitePage = 'home'): string {
  return page === 'home' ? `${locale}/` : `${locale}/${page}/`
}

export function getPageSeo(locale: Locale, page: SitePage = 'home') {
  if (page === 'home') return getSeo(locale)
  const seo = getSeo(locale)
  const content = getContent(locale)
  const doc = page === 'pricing' ? content.pricing : content.legal[page]
  return { ...seo, title: `${doc.title} — umuo`, description: doc.description }
}
