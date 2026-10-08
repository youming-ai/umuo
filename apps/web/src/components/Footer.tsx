import { CONTACT_EMAIL } from '../config'
import type { Locale, SiteContent } from '../content/types'
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
  const { footer } = content
  return (
    <footer className="site-footer container-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-text-tertiary">{footer.copyright}</p>
        <div className="flex flex-wrap items-center gap-5">
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm text-text-secondary">
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
