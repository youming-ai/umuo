import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { HTML_LANG, LOCALES, SITE_URL } from './src/config'
import type { Locale } from './src/content/types'
import { getPageSeo, pagePath, SITE_PAGES, type SitePage } from './src/lib/pages'

const DEFAULT_LOCALE: Locale = 'zh-cn'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 每种语言一份 head：title / description / canonical / hreflang / OG / Twitter Card */
function seoHead(locale: Locale, page: SitePage = 'home'): string {
  const seo = getPageSeo(locale, page)
  const url = `${SITE_URL}${pagePath(locale, page)}`
  const alternates = [
    ...LOCALES.map(
      (alt) =>
        `    <link rel="alternate" hreflang="${alt}" href="${SITE_URL}${pagePath(alt, page)}" />`,
    ),
    `    <link rel="alternate" hreflang="x-default" href="${SITE_URL}${pagePath(DEFAULT_LOCALE, page)}" />`,
  ].join('\n')

  return `<!-- seo:start -->
    <title>${escapeHtml(seo.title)}</title>
    <meta name="description" content="${escapeHtml(seo.description)}" />
    <link rel="canonical" href="${url}" />
${alternates}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="umuo" />
    <meta property="og:title" content="${escapeHtml(seo.title)}" />
    <meta property="og:description" content="${escapeHtml(seo.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:locale" content="${seo.ogLocale}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(seo.title)}" />
    <meta name="twitter:description" content="${escapeHtml(seo.description)}" />
    <!-- seo:end -->`
}

/**
 * 多语言静态产物：dist/zh-cn/index.html、dist/en/index.html …
 *
 * 单页应用只有运行时才知道当前语言，爬虫和禁用 JS 的访客拿不到正确的
 * title / hreflang。这里在构建时把每种语言的 head 写进各自的 index.html，
 * 顺便让 /ja/ 这类深链在纯静态托管上也能直接命中。
 *
 * 代价：配置文件必须 import 内容模型（`./src/content`），而 Vite 8 会对这类
 * 「配置里带相对导入」的写法发一条未来兼容性警告（native config loader 尚不支持）。
 * 它是信息性的、不影响产物，所以 build 脚本用 `VITE_CONFIG_NATIVE_IGNORE_WARNING=true`
 * 静音掉噪音。**注意**这条警告会在 Vite 把 native loader 设为默认时变成硬错误，
 * 届时要么给导入补扩展名（需开 `allowImportingTsExtensions`），
 * 要么把内容注入挪出配置文件。
 */
function localeHtmlPlugin(): Plugin {
  return {
    name: 'umuo-locale-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const entry = bundle['index.html']
      if (entry?.type !== 'asset') return

      const template = String(entry.source)
      if (!template.includes('<!-- seo:start -->')) {
        this.error(
          'index.html 缺少 <!-- seo:start --> / <!-- seo:end --> 标记，无法注入多语言 head',
        )
      }

      const htmlFor = (locale: Locale, page: SitePage = 'home') =>
        template
          .replace(/<html lang="[^"]*"/, `<html lang="${HTML_LANG[locale] ?? locale}"`)
          .replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, seoHead(locale, page))

      // 根路径保留默认语言的 head（SPA 回退时用得到），再为每种语言产出独立目录
      entry.source = htmlFor(DEFAULT_LOCALE)
      for (const locale of LOCALES) {
        for (const page of SITE_PAGES) {
          this.emitFile({
            type: 'asset',
            fileName: `${pagePath(locale, page).slice(1)}index.html`,
            source: htmlFor(locale, page),
          })
        }
      }

      this.info(`已生成多语言 HTML：${LOCALES.map((locale) => `/${locale}/`).join(' ')}`)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localeHtmlPlugin()],
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
})
