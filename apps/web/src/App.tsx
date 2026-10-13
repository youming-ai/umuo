import { useEffect } from 'react'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { LanguageGrid } from './components/LanguageGrid'
import { LegalPage } from './components/LegalPage'
import { Nav } from './components/Nav'
import { getContent } from './content'
import { useRoute } from './lib/router'
import { applySeo } from './lib/seo'
import { useTheme } from './lib/theme'

/** 首页只有一屏：页眉 logo、首屏、页脚，垫在全屏字符网格上；条款与隐私政策是普通的长文页。 */
export function App() {
  const { locale, page } = useRoute()
  const { theme, toggleTheme } = useTheme()
  const content = getContent(locale)

  useEffect(() => {
    applySeo(locale, page)
  }, [locale, page])

  return (
    <div
      id="top"
      className={`landing landing-${page} min-h-screen bg-background text-text-primary`}
    >
      {page === 'home' && <LanguageGrid />}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-text-primary"
      >
        {content.nav.skipToContent}
      </a>
      <Nav locale={locale} />
      <main id="main">
        {page === 'home' ? (
          <Hero content={content} locale={locale} />
        ) : (
          <LegalPage doc={content.legal[page]} />
        )}
      </main>
      <Footer content={content} locale={locale} theme={theme} onToggleTheme={toggleTheme} />
    </div>
  )
}
