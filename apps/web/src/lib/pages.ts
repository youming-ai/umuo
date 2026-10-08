import { getContent, getSeo } from '../content'
import type { Locale } from '../content/types'

export const SITE_PAGES = ['home', 'pricing'] as const
export type SitePage = (typeof SITE_PAGES)[number]

export function pageFromPath(pathname: string): SitePage {
  return pathname.split('/').filter(Boolean)[1] === 'pricing' ? 'pricing' : 'home'
}

export function pagePath(locale: Locale, page: SitePage = 'home'): string {
  return `/${locale}/${page === 'pricing' ? 'pricing/' : ''}`
}

export function getPageSeo(locale: Locale, page: SitePage = 'home') {
  const seo = getSeo(locale)
  if (page === 'home') return seo
  const { pricing } = getContent(locale)
  return { ...seo, title: `${pricing.title} — umuo`, description: pricing.description }
}
