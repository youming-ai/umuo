import { GITHUB_URL } from '../config'
import type { Locale } from '../content/types'
import { localeHref } from '../lib/router'
import { GitHubIcon, LogoMark } from './icons'

/** 页眉：左边 logo，右边 GitHub。站点只有首页一屏，没有别的页面可去。 */
export function Nav({ locale }: { locale: Locale }) {
  return (
    <header className="site-nav absolute z-40">
      <div className="container-page flex items-center">
        <a
          href={localeHref(locale)}
          className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-text-primary"
        >
          <LogoMark className="h-10 w-10" />
          <span>umuo</span>
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          title="GitHub"
          className="ms-auto -me-2 inline-flex h-10 w-10 items-center justify-center rounded-control text-text-secondary transition-colors hover:text-text-primary"
        >
          <GitHubIcon className="h-6 w-6" />
        </a>
      </div>
    </header>
  )
}
