import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import { LOCALES } from '../config'
import type { Locale } from '../content/types'
import { pageFromPath, pagePath, type SitePage } from './pages'

type Route = { locale: Locale; hash: string; page: SitePage }

/**
 * 极简路由：地址永远是 `/`，语言不进 URL。
 * 当前语言写在 `<html data-locale>` 上——预渲染时写好，Worker 按 cookie / 浏览器语言挑对应的那份；
 * 切换语言时写 cookie 并就地换内容，下次访问 Worker 就会直接给这种语言。页面清单见 ./pages。
 */

export const DEFAULT_LOCALE: Locale = 'zh-cn'

/** 从 pathname 里取语言前缀；没有已知前缀时返回 null */
export function localeFromPath(pathname: string): Locale | null {
  const segment = pathname.split('/').filter(Boolean)[0]
  if (!segment) return null
  return (LOCALES as readonly string[]).includes(segment) ? (segment as Locale) : null
}

/** 当前 hash（去掉 #），没有则为空串 */
export function currentHash(): string {
  return window.location.hash.replace(/^#/, '')
}

export function localeHref(locale: Locale, hash?: string, page: SitePage = 'home'): string {
  const path = pagePath(locale, page)
  return hash ? `${path}#${hash}` : path
}

/** Worker 读这个 cookie 决定 `/` 返回哪种语言（见 worker/src/locale.ts） */
export const LOCALE_COOKIE = 'umuo-lang'

/** 页面当前的语言：预渲染 / Worker 写在 <html data-locale> 上 */
function documentLocale(): Locale | null {
  const value = document.documentElement.dataset.locale ?? ''
  return (LOCALES as readonly string[]).includes(value) ? (value as Locale) : null
}

/** 就地切换语言：记进 cookie（一年），更新 <html data-locale>，地址不变 */
export function switchLocale(locale: Locale) {
  // biome-ignore lint/suspicious/noDocumentCookie: Worker 只能读 cookie，localStorage 它看不到
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
  document.documentElement.dataset.locale = locale
  notifyRouteChange()
}

function notifyRouteChange() {
  window.dispatchEvent(new Event('umuo:route'))
}

/** 从当前 URL 读出路由状态；放在组件外，避免 effect 依赖每次渲染新建的函数 */
function readRoute(): Route {
  // 服务端渲染（构建期预渲染）没有 window：语言由 entry-server 提前注入。
  // 没有这个分支的话，预渲染会直接抛 ReferenceError，而不是降级。
  if (typeof window === 'undefined') {
    return ssrInitialRoute ?? { locale: DEFAULT_LOCALE, hash: '', page: 'home' }
  }
  return {
    locale: documentLocale() ?? DEFAULT_LOCALE,
    hash: currentHash(),
    page: pageFromPath(window.location.pathname),
  }
}

/**
 * 构建期预渲染时由 `src/entry-server.tsx` 注入初始语言。
 *
 * 之所以用模块级变量而不是 props：`App` 内部通过 [`useRoute`] 取语言，
 * 而 `useRoute` 在服务端拿不到 URL。把语言从入口灌进来，能让客户端与服务端
 * 共用同一套组件，不需要为 SSR 复制一份 App。
 */
let ssrInitialRoute: Route | null = null

export function setInitialRouteForSsr(route: {
  locale: Locale
  hash: string
  page?: SitePage
}): void {
  ssrInitialRoute = { ...route, page: route.page ?? 'home' }
}

/** 订阅 pathname / hash 变化（含浏览器前进后退） */
export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute)

  useEffect(() => {
    const update = () => setRoute(readRoute())
    window.addEventListener('popstate', update)
    window.addEventListener('hashchange', update)
    window.addEventListener('umuo:route', update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener('hashchange', update)
      window.removeEventListener('umuo:route', update)
    }
  }, [])

  return route
}

interface LocaleLinkProps {
  locale: Locale
  children: ReactNode
  className?: string
  current?: boolean
  onNavigate?: () => void
}

/**
 * 语言切换链接。点击时就地切换（地址不变、停在原位）；
 * `href` 指向 `/<locale>/`，给中键 / 禁用 JS 的情况兜底——Worker 会记住语言再跳回 `/`。
 */
export function LocaleLink({ locale, children, className, current, onNavigate }: LocaleLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    switchLocale(locale)
    onNavigate?.()
  }

  return (
    <a
      href={`/${locale}/`}
      lang={locale}
      className={className}
      aria-current={current ? 'true' : undefined}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}
