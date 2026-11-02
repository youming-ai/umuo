import { SOURCE_PUBLIC, SOURCE_URL } from '../config'
import type { Locale } from '../content/types'
import type { SitePage } from '../lib/pages'
import { localeHref } from '../lib/router'
import { LogoMark } from './icons'

/**
 * 页眉：左边 logo（回首页），右边 GitHub 源码链接（原「免费与开源」的位置，仓库公开即 `SOURCE_PUBLIC` 时才出现）。
 * 条款与隐私政策从页脚进入。高度由 `.site-nav > .container-page` 固定为 4rem，只剩 logo 也不会塌。
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
        {SOURCE_PUBLIC ? (
          // 品牌名不翻译；样式沿用原来右侧「免费与开源」链接
          <a
            href={SOURCE_URL}
            className="-me-3 ms-auto px-3 text-[0.9375rem] font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            GitHub
          </a>
        ) : null}
      </div>
    </header>
  )
}
