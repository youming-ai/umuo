import type { Locale } from '../content/types'
import { localeHref } from '../lib/router'
import { LogoMark } from './icons'

/** 页眉暂时只放 logo：站点只有首页一屏，没有别的页面可去。 */
export function Nav({ locale }: { locale: Locale }) {
  return (
    <header className="site-nav absolute z-40">
      <div className="container-page flex items-center">
        <a
          href={localeHref(locale)}
          className="flex items-center gap-2 text-lg font-semibold tracking-tight text-text-primary"
        >
          <LogoMark className="h-6 w-6 u-accent-text" />
          <span>umuo</span>
        </a>
      </div>
    </header>
  )
}
