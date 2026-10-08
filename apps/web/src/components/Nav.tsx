import { useState } from 'react'
import { MACOS_DOWNLOAD_URL } from '../config'
import type { Locale, SiteContent } from '../content/types'
import { navTarget } from '../lib/links'
import { localeHref, navigateTo, SiteLink } from '../lib/router'
import type { Theme } from '../lib/theme'
import { CloseIcon, DownloadIcon, LogoMark, MenuIcon, MoonIcon, SunIcon } from './icons'
import { LanguageMenu } from './LanguageSwitcher'

interface NavProps {
  content: SiteContent
  locale: Locale
  hash: string
  theme: Theme
  onToggleTheme: () => void
}

const linkClass =
  'px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-background-tertiary hover:text-text-primary'

export function Nav({ content, locale, hash, theme, onToggleTheme }: NavProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { nav } = content

  const openHome = () => navigateTo(localeHref(locale))

  const downloadButton = MACOS_DOWNLOAD_URL ? (
    <a href={MACOS_DOWNLOAD_URL} className="btn-primary h-9 px-4 text-xs" download>
      <DownloadIcon className="h-4 w-4" />
      {nav.download}
    </a>
  ) : (
    <SiteLink
      locale={locale}
      hash="download"
      className="btn-primary h-9 px-4 text-xs"
      onNavigate={() => setMenuOpen(false)}
    >
      <DownloadIcon className="h-4 w-4" />
      {nav.download}
    </SiteLink>
  )

  const navLinks = nav.links.map((link) => {
    const target = navTarget(link.kind)
    return (
      <li key={link.kind}>
        <SiteLink
          locale={locale}
          hash={target.hash}
          className={linkClass}
          onNavigate={() => setMenuOpen(false)}
        >
          {link.label}
        </SiteLink>
      </li>
    )
  })

  return (
    <header className="site-nav sticky top-0 z-40 border-border border-b">
      <div className="container-page flex items-center gap-8">
        <a
          href={localeHref(locale)}
          onClick={(event) => {
            event.preventDefault()
            openHome()
          }}
          className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight text-text-primary"
        >
          <LogoMark className="h-6 w-6 u-accent-text" />
          <span>umuo</span>
        </a>

        <nav aria-label={nav.mainNavLabel} className="hidden xl:block">
          <ul className="flex items-center gap-1">{navLinks}</ul>
        </nav>

        <div className="ms-auto flex items-center gap-1">
          <LanguageMenu locale={locale} hash={hash} label={nav.languageLabel} />
          <button
            type="button"
            onClick={onToggleTheme}
            className="btn-ghost h-9 w-9 min-w-9 p-0"
            title={theme === 'dark' ? nav.themeToLight : nav.themeToDark}
            // 预渲染发生在构建期，不可能知道访客偏好哪种主题，所以 title 在服务端与
            // 客户端之间**必然可能**不同。suppressHydrationWarning 只覆盖属性与文本，
            // 所以这里必须只有属性差异——图标结构见下面的注释。
            suppressHydrationWarning
          >
            {/*
              两个图标都留在 DOM 里，由 CSS 按 <html data-theme> 显示其中一个。
              **不能**按 theme 条件渲染：那会让服务端与客户端的元素结构不同，
              属于 hydration 硬错误（React #418），suppressHydrationWarning 压不住，
              后果是整棵树在客户端被丢掉重渲染——预渲染也就白做了。
            */}
            <SunIcon className="h-5 w-5 umuo-theme-when-dark" />
            <MoonIcon className="h-5 w-5 umuo-theme-when-light" />
            <span className="sr-only">{nav.themeLabel}</span>
          </button>
          <div className="hidden sm:block">{downloadButton}</div>
          <button
            type="button"
            className="btn-ghost h-9 w-9 min-w-9 p-0 xl:hidden"
            aria-expanded={menuOpen}
            aria-controls="umuo-mobile-menu"
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
            <span className="sr-only">{menuOpen ? nav.menuClose : nav.menuOpen}</span>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div
          id="umuo-mobile-menu"
          className="mx-auto mt-2 max-w-5xl border border-border bg-background xl:hidden"
        >
          <div className="flex flex-col gap-2 p-4">
            <ul className="flex flex-col gap-1">{navLinks}</ul>
            <div className="pt-2 sm:hidden">{downloadButton}</div>
          </div>
        </div>
      ) : null}
    </header>
  )
}
