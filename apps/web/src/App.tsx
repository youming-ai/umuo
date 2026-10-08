import { useEffect } from 'react'
import { ByokSection } from './components/ByokSection'
import { ComparisonTable } from './components/ComparisonTable'
import { Faq } from './components/Faq'
import { FeatureGrid } from './components/FeatureGrid'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { LogoWall } from './components/LogoWall'
import { Nav } from './components/Nav'
import { Pillars } from './components/Pillars'
import { Pricing } from './components/Pricing'
import { ShortcutBar } from './components/ShortcutBar'
import { getContent } from './content'
import { useRoute } from './lib/router'
import { applySeo } from './lib/seo'
import { useTheme } from './lib/theme'

/** 排成一本对照本：首屏 → 读写看 → 模型 → 快捷键与 BYOK → 功能 → 定价对比 → FAQ。 */
export function App() {
  const { locale, hash } = useRoute()
  const { theme, toggleTheme } = useTheme()
  const content = getContent(locale)

  useEffect(() => {
    applySeo(locale)
  }, [locale])

  return (
    <div id="top" className="landing min-h-screen bg-background text-text-primary">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-text-primary"
      >
        {content.nav.skipToContent}
      </a>

      <Nav
        content={content}
        locale={locale}
        hash={hash}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main id="main">
        <Hero content={content} locale={locale} />
        <Pillars content={content} locale={locale} />
        <LogoWall content={content} />
        <ShortcutBar content={content} />
        <ByokSection content={content} />
        <FeatureGrid content={content} />
        <Pricing content={content} />
        <ComparisonTable content={content} />
        <Faq content={content} />
      </main>

      <Footer content={content} locale={locale} hash={hash} />
    </div>
  )
}
