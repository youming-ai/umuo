import type { Locale, SiteContent } from '../content/types'
import type { Theme } from '../lib/theme'
import { LanguageMenu } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'

/**
 * 极简页脚：左边版权，右边语言与主题切换，不放任何链接、不重复下载 CTA。
 * 源码入口只在页眉右侧（GitHub）。
 */
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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-text-tertiary">{footer.copyright}</p>
        <div className="flex items-center gap-1">
          <LanguageMenu locale={locale} label={footer.languageLabel} placement="top" />
          <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} labels={content.nav} />
        </div>
      </div>
    </footer>
  )
}
