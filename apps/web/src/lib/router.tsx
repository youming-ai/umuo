import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import { LOCALES } from '../config'
import type { Locale } from '../content/types'

/**
 * 极简路径前缀路由：`/zh-cn/`、`/zh-tw/`、`/en/`、`/ja/`，其余路径一律回到默认语言。
 * 官网只有一页，因此不需要路由库；语言前缀 + 锚点就够了。
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

export function localeHref(locale: Locale, hash?: string): string {
  return hash ? `/${locale}/#${hash}` : `/${locale}/`
}

function notifyRouteChange() {
  window.dispatchEvent(new Event('umuo:route'))
}

/**
 * 客户端跳转：改 URL、重新渲染、滚到目标锚点。
 * 不用整页刷新，所以静态托管只要把各语言目录指到同一份 HTML 就能用。
 */
export function navigateTo(href: string, hash?: string) {
  window.history.pushState(null, '', href)
  notifyRouteChange()
  if (hash) {
    document.getElementById(hash)?.scrollIntoView({ block: 'start' })
    return
  }
  window.scrollTo({ top: 0 })
}

/** 从当前 URL 读出路由状态；放在组件外，避免 effect 依赖每次渲染新建的函数 */
function readRoute(): { locale: Locale; hash: string } {
  // 服务端渲染（构建期预渲染）没有 window：语言由 entry-server 提前注入。
  // 没有这个分支的话，预渲染会直接抛 ReferenceError，而不是降级。
  if (typeof window === 'undefined') {
    return ssrInitialRoute ?? { locale: DEFAULT_LOCALE, hash: '' }
  }
  return {
    locale: localeFromPath(window.location.pathname) ?? DEFAULT_LOCALE,
    hash: currentHash(),
  }
}

/**
 * 构建期预渲染时由 `src/entry-server.tsx` 注入初始语言。
 *
 * 之所以用模块级变量而不是 props：`App` 内部通过 [`useRoute`] 取语言，
 * 而 `useRoute` 在服务端拿不到 URL。把语言从入口灌进来，能让客户端与服务端
 * 共用同一套组件，不需要为 SSR 复制一份 App。
 */
let ssrInitialRoute: { locale: Locale; hash: string } | null = null

export function setInitialRouteForSsr(route: { locale: Locale; hash: string }): void {
  ssrInitialRoute = route
}

/** 订阅 pathname / hash 变化（含浏览器前进后退） */
export function useRoute(): { locale: Locale; hash: string } {
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

interface SiteLinkProps {
  locale: Locale
  /** 站内锚点，例如 `pricing` */
  hash: string
  children: ReactNode
  className?: string
  title?: string
  onNavigate?: () => void
}

/** 站内锚点链接：中键 / 组合键仍然走浏览器默认行为 */
export function SiteLink({ locale, hash, children, className, title, onNavigate }: SiteLinkProps) {
  const href = localeHref(locale, hash)
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    navigateTo(href, hash)
    onNavigate?.()
  }

  return (
    <a href={href} className={className} title={title} onClick={handleClick}>
      {children}
    </a>
  )
}

interface LocaleLinkProps {
  locale: Locale
  hash: string
  children: ReactNode
  className?: string
  current?: boolean
  onNavigate?: () => void
}

/** 语言切换链接：保留当前锚点，切语言后停在同一个位置 */
export function LocaleLink({
  locale,
  hash,
  children,
  className,
  current,
  onNavigate,
}: LocaleLinkProps) {
  const href = localeHref(locale, hash)
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    navigateTo(href, hash)
    onNavigate?.()
  }

  return (
    <a
      href={href}
      className={className}
      hrefLang={locale}
      aria-current={current ? 'true' : undefined}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}
