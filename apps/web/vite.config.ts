import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { HTML_LANG, LOCALES, SITE_URL } from './src/config'
import type { Locale } from './src/content/types'
import { getPageSeo, localeDir, pagePath, type SitePage } from './src/lib/pages'

const DEFAULT_LOCALE: Locale = 'zh-cn'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 每种语言一份 head：title / description / canonical / OG / Twitter Card。地址只有 `/`，不写 hreflang */
function seoHead(locale: Locale, page: SitePage = 'home'): string {
  const seo = getPageSeo(locale, page)
  const url = `${SITE_URL}${pagePath(locale, page)}`

  return `<!-- seo:start -->
    <title>${escapeHtml(seo.title)}</title>
    <meta name="description" content="${escapeHtml(seo.description)}" />
    <link rel="canonical" href="${url}" />
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
 * 这些是**内部文件**：访客的地址永远是 `/`，由 Worker 按 cookie / 浏览器语言挑一份返回
 * （见 worker/src/locale.ts）。每份的 `<html>` 带 `lang` 与 `data-locale`，客户端靠后者
 * 知道当前语言；head 也按语言写好，爬虫和禁用 JS 的访客拿到的就是对应语言。
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
          .replace(
            /<html lang="[^"]*"/,
            `<html lang="${HTML_LANG[locale] ?? locale}" data-locale="${locale}"`,
          )
          .replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, seoHead(locale, page))

      // 根路径保留默认语言（Worker 不在时的兜底），再为每种语言产出一份内部文件
      entry.source = htmlFor(DEFAULT_LOCALE)
      for (const locale of LOCALES) {
        this.emitFile({
          type: 'asset',
          fileName: `${localeDir(locale)}index.html`,
          source: htmlFor(locale),
        })
      }

      this.info(`已生成多语言 HTML：${LOCALES.map((locale) => localeDir(locale)).join(' ')}`)
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
