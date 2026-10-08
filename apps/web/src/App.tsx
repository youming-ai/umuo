import { useEffect } from 'react'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { LanguageGrid } from './components/LanguageGrid'
import { Nav } from './components/Nav'
import { Pricing } from './components/Pricing'
import { getContent } from './content'
import { useRoute } from './lib/router'
import { applySeo } from './lib/seo'
import { useTheme } from './lib/theme'

/** 主屏与独立定价页，共用悬浮导航和全屏字符背景。 */
export function App() {
  const { locale, hash, page } = useRoute()
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
      <LanguageGrid />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-text-primary"
      >
        {content.nav.skipToContent}
      </a>
      <Nav content={content} locale={locale} page={page} />
      <main id="main" className={page === 'pricing' ? 'pricing-page' : undefined}>
        {page === 'home' ? (
          <Hero content={content} locale={locale} />
        ) : (
          <Pricing content={content} />
        )}
      </main>
      <Footer
        content={content}
        locale={locale}
        hash={hash}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </div>
  )
}
