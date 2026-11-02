import type { Locale } from '../content/types'
import type { SitePage } from '../lib/pages'
import { localeHref } from '../lib/router'
import { LogoMark } from './icons'

/**
 * 页眉：只有左边的 logo（回首页），条款与隐私政策从页脚进入。
 * 高度由 `.site-nav > .container-page` 固定为 4rem，只剩 logo 也不会塌。
 */
export function Nav({ locale, page }: { locale: Locale; page?: SitePage }) {
  return (
    <header className="site-nav absolute z-40">
      <div className="container-page flex items-center">
        <a
          href={localeHref(locale)}
          aria-current={page === 'home' ? 'page' : undefined}
          className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-text-primary !no-underline"
        >
          <LogoMark className="h-10 w-10" />
          <span>umuo</span>
        </a>
      </div>
    </header>
  )
}
