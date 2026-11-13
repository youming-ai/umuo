import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import { DEFAULT_LOCALE, LOCALES } from '../config'
import type { Locale } from '../content/types'
import { withViewTransition } from './transition'

/**
 * 极简「路由」：站点只有首页，地址永远是 `/`，语言不进 URL，于是只剩「当前是哪种语言」。
 * 当前语言写在 `<html data-locale>` 上——预渲染时写好，Worker 按 cookie / 浏览器语言挑对应的那份；
 * 切换语言时写 cookie 并就地换内容，下次访问 Worker 就会直接给这种语言。
 */

function isLocale(value: string | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '')
}

/** 从 pathname 里取语言前缀；没有已知前缀时返回 null */
export function localeFromPath(pathname: string): Locale | null {
  const segment = pathname.split('/').filter(Boolean)[0]
  return isLocale(segment) ? segment : null
}

/** Worker 读这个 cookie 决定 `/` 返回哪种语言（见 worker/src/locale.ts） */
export const LOCALE_COOKIE = 'umuo-lang'

/** 页面当前的语言：预渲染 / Worker 写在 <html data-locale> 上 */
function documentLocale(): Locale | null {
  const value = document.documentElement.dataset.locale
  return isLocale(value) ? value : null
}

/** 就地切换语言：记进 cookie（一年），更新 <html data-locale>，地址不变 */
export function switchLocale(locale: Locale) {
  // biome-ignore lint/suspicious/noDocumentCookie: Worker 只能读 cookie，localStorage 它看不到
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
  document.documentElement.dataset.locale = locale
  window.dispatchEvent(new Event('umuo:locale'))
}

/**
 * 构建期预渲染时由 `src/entry-server.tsx` 注入的语言。
 *
 * 之所以用模块级变量而不是 props：`App` 内部通过 [`useLocale`] 取语言，
 * 而服务端没有 `<html data-locale>` 可读。把语言从入口灌进来，能让客户端与服务端
 * 共用同一套组件，不需要为 SSR 复制一份 App。
 */
let ssrLocale: Locale | null = null

export function setInitialLocaleForSsr(locale: Locale): void {
  ssrLocale = locale
}

function readLocale(): Locale {
  // 服务端渲染（构建期预渲染）没有 window：语言由 entry-server 提前注入。
  // 没有这个分支的话，预渲染会直接抛 ReferenceError，而不是降级。
  if (typeof window === 'undefined') return ssrLocale ?? DEFAULT_LOCALE
  return documentLocale() ?? DEFAULT_LOCALE
}

/** 当前语言；切换语言后跟着更新 */
export function useLocale(): Locale {
  const [locale, setLocale] = useState(readLocale)

  useEffect(() => {
    const update = () => setLocale(readLocale())
    window.addEventListener('umuo:locale', update)
    return () => window.removeEventListener('umuo:locale', update)
  }, [])

  return locale
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
    // 换文案与收起菜单放进同一次过渡：五种语言的行长不同，整页短淡化比硬切稳
    withViewTransition(() => {
      switchLocale(locale)
      onNavigate?.()
    })
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
