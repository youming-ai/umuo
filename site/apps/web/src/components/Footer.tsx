import { CONTACT_EMAIL, SOURCE_PUBLIC, SOURCE_URL } from '../config'
import type { Locale, SiteContent } from '../content/types'
import { pagePath } from '../lib/pages'
import type { Theme } from '../lib/theme'
import { LanguageMenu } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'

/** 两页共用的简短页脚，不再重复一整块下载 CTA。 */
export function Footer({
  content,
  locale,
  theme,
  onToggleTheme,
}: {
  content: SiteContent
  locale: Locale
  theme: Theme
  onToggleTheme: () => void
}) {
  const { footer, legal } = content
  return (
    <footer className="site-footer container-page">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {/* 条款与隐私政策作为小字跟在版权后面：手机上页脚仍是两行，首页不因此多出滚动 */}
        <div className="footer-legal flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <p>{footer.copyright}</p>
          <a href={pagePath(locale, 'terms')}>{legal.terms.title}</a>
          <a href={pagePath(locale, 'privacy')}>{legal.privacy.title}</a>
        </div>
        <div className="footer-tools flex flex-wrap items-center gap-5">
          {/* 仓库公开前（SOURCE_PUBLIC 为 false）不放链接；打开后这里多一个小字链接，首页高度需重新量 */}
          {SOURCE_PUBLIC ? (
            <a href={SOURCE_URL} className="text-xs text-text-tertiary hover:text-text-primary">
              {footer.source}
            </a>
          ) : null}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-xs text-text-tertiary hover:text-text-primary"
          >
            {footer.contact}
          </a>
          <div className="flex items-center gap-1">
            <LanguageMenu locale={locale} label={footer.languageLabel} placement="top" />
            <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} labels={content.nav} />
          </div>
        </div>
      </div>
    </footer>
  )
}
