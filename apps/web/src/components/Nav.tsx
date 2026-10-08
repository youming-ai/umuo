import { useState } from 'react'
import { MACOS_DOWNLOAD_URL } from '../config'
import type { Locale, SiteContent } from '../content/types'
import type { SitePage } from '../lib/pages'
import { localeHref, navigateTo, SiteLink } from '../lib/router'
import { CloseIcon, DownloadIcon, LogoMark, MenuIcon } from './icons'

interface NavProps {
  content: SiteContent
  locale: Locale
  page: SitePage
}

const linkClass = 'px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary'

export function Nav({ content, locale, page }: NavProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { nav } = content

  const openHome = () => navigateTo(localeHref(locale))

  const downloadButton = MACOS_DOWNLOAD_URL ? (
    <a href={MACOS_DOWNLOAD_URL} className="btn-primary h-9 px-4 text-xs" download>
      <DownloadIcon className="h-4 w-4" />
      {nav.download}
    </a>
  ) : (
    <button
      type="button"
      disabled
      title={content.hero.platforms.find((platform) => platform.id === 'macos')?.statusLabel}
      className="btn-primary h-9 px-4 text-xs"
    >
      <DownloadIcon className="h-4 w-4" />
      {nav.download}
    </button>
  )

  const navLinks = nav.links.map((link) => {
    const targetPage = link.kind === 'pricing' ? 'pricing' : 'home'
    return (
      <li key={link.kind}>
        <SiteLink
          locale={locale}
          page={targetPage}
          current={page === targetPage}
          className={linkClass}
          onNavigate={() => setMenuOpen(false)}
        >
          {link.label}
        </SiteLink>
      </li>
    )
  })

  return (
    <header className="site-nav fixed z-40">
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

        <nav aria-label={nav.mainNavLabel} className="hidden md:block">
          <ul className="flex items-center gap-1">{navLinks}</ul>
        </nav>

        <div className="ms-auto flex items-center gap-1">
          <div className="hidden sm:block">{downloadButton}</div>
          <button
            type="button"
            className="btn-ghost h-9 w-9 min-w-9 p-0 md:hidden"
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
          className="mx-auto mt-2 max-w-5xl border border-border bg-background md:hidden"
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
