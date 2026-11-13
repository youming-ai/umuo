import { SOURCE_PUBLIC, SOURCE_URL } from '../config'
import { GitHubIcon, LogoMark } from './icons'

/**
 * 页眉：左边 logo（回首页），右边 GitHub 源码链接（原「免费与开源」的位置，仓库公开即 `SOURCE_PUBLIC` 时才出现）。
 * 这是站内唯一的源码入口。高度由 `.site-nav > .container-page` 固定为 4rem，只剩 logo 也不会塌。
 */
export function Nav() {
  return (
    <header className="site-nav absolute z-40">
      <div className="container-page flex items-center">
        <a
          href="/"
          className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-text-primary !no-underline"
        >
          <LogoMark className="h-10 w-10" />
          <span>umuo</span>
        </a>
        {SOURCE_PUBLIC ? (
          // 只放 GitHub 标志，名称交给 aria-label 与 title；44px 点击区，颜色与悬停沿用原来的文字链接
          <a
            href={SOURCE_URL}
            aria-label="GitHub"
            title="GitHub"
            className="-me-2.5 ms-auto inline-flex h-11 w-11 items-center justify-center nav-icon-link rounded-full text-text-secondary hover:text-text-primary"
          >
            <GitHubIcon className="h-6 w-6" />
          </a>
        ) : null}
      </div>
    </header>
  )
}
