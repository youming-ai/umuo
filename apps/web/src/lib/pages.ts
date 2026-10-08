import { getSeo } from '../content'
import type { Locale } from '../content/types'

/**
 * 站点页面清单。目前只有首页，地址永远是 `/`，语言不进 URL：
 * 构建时每种语言预渲染一份 `dist/<locale>/index.html`，由 Worker 按 cookie / 浏览器语言挑一份返回。
 * 以后加页面从这里开始。
 */
export const SITE_PAGES = ['home'] as const
export type SitePage = (typeof SITE_PAGES)[number]

export function pageFromPath(_pathname: string): SitePage {
  return 'home'
}

/** 对外的页面地址：不带语言前缀 */
export function pagePath(_locale: Locale, _page: SitePage = 'home'): string {
  return '/'
}

/** 预渲染产物在 dist 里的目录（内部文件，访客看不到这个路径） */
export function localeDir(locale: Locale): string {
  return `${locale}/`
}

export function getPageSeo(locale: Locale, _page: SitePage = 'home') {
  return getSeo(locale)
}
