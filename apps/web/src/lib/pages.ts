import { getSeo } from '../content'
import type { Locale } from '../content/types'

/**
 * 站点页面清单。定价页暂时下线，现在只有首页；路由、预渲染与 SEO 都按这张表生成，
 * 以后加页面只需在这里加一项并补上路径规则。
 */
export const SITE_PAGES = ['home'] as const
export type SitePage = (typeof SITE_PAGES)[number]

export function pageFromPath(_pathname: string): SitePage {
  return 'home'
}

export function pagePath(locale: Locale, _page: SitePage = 'home'): string {
  return `/${locale}/`
}

export function getPageSeo(locale: Locale, _page: SitePage = 'home') {
  return getSeo(locale)
}
