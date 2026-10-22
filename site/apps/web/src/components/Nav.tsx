import { getContent } from '../content'
import type { Locale } from '../content/types'
import { pagePath } from '../lib/pages'
import { localeHref } from '../lib/router'
import { LogoMark } from './icons'

/** 页眉：左边 logo（回首页），右边定价。条款与隐私政策从页脚进入。 */
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
          href={pagePath(locale, 'pricing')}
          className="-me-3 ms-auto px-3 text-[0.9375rem] text-text-secondary transition-colors hover:text-text-primary"
        >
          {getContent(locale).pricing.title}
        </a>
      </div>
    </header>
  )
}
