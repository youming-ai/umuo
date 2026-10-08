import { CONTACT_EMAIL } from '../config'
import type { Locale, SiteContent } from '../content/types'
import type { Theme } from '../lib/theme'
import { LanguageMenu } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'

/** 两页共用的简短页脚，不再重复一整块下载 CTA。 */
export function Footer({
  content,
  locale,
  hash,
  theme,
  onToggleTheme,
}: {
  content: SiteContent
  locale: Locale
  hash: string
  theme: Theme
  onToggleTheme: () => void
}) {
  const { footer } = content
  const contact = footer.columns
    .flatMap((column) => column.links)
    .find((link) => link.kind === 'contact')
  return (
    <footer className="site-footer container-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-text-tertiary">{footer.copyright}</p>
        <div className="flex flex-wrap items-center gap-5">
          {contact ? (
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm text-text-secondary">
              {contact.label}
            </a>
          ) : null}
          <div className="flex items-center gap-1">
            <LanguageMenu
              locale={locale}
              hash={hash}
              label={footer.languageLabel}
              placement="top"
            />
            <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} labels={content.nav} />
          </div>
        </div>
      </div>
    </footer>
  )
}
