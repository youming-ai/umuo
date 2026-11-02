import { getSeo } from '../content'
import type { Locale } from '../content/types'

/**
 * 站点页面清单：目前只有首页 `/`。语言不进 URL：
 * 构建时每种语言预渲染一份 `dist/<locale>/[<page>/]index.html`，由 Worker 按 cookie / 浏览器语言挑一份返回。
 * 加页面从这里开始（Worker 的 dispatch / locale 也要相应加上路由）。
 * 旧的 `/pricing`（「免费与开源」页）、`/terms`（服务条款）与 `/privacy`（隐私政策）已删除，
 * 旧地址按未知页面返回 404。
 */
export const SITE_PAGES = ['home'] as const
export type SitePage = (typeof SITE_PAGES)[number]

/** 最后一段是已知页面就取它；其余（含已删除的 `/terms`、`/privacy`）一律算首页 */
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

/** 页面的 SEO；只有首页，直接用首页的 */
export function getPageSeo(locale: Locale, _page: SitePage = 'home') {
  return getSeo(locale)
}
