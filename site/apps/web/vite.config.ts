import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { DEFAULT_LOCALE, HTML_LANG, LOCALES } from './src/config'
import type { Locale } from './src/content/types'
import { replaceLiteral } from './src/lib/html'
import { headTags } from './src/lib/seo'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把 lib/seo.ts 的 headTags 写成 HTML，替换 index.html 里 seo:start / seo:end 之间的占位 */
function seoHead(locale: Locale): string {
  const head = headTags(locale)
  const meta = head.meta.map(
    ([attr, key, content]) => `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`,
  )
  return [
    '<!-- seo:start -->',
    `<title>${escapeHtml(head.title)}</title>`,
    `<link rel="canonical" href="${head.canonical}" />`,
    ...meta,
    '<!-- seo:end -->',
  ].join('\n    ')
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

      const htmlFor = (locale: Locale) =>
        replaceLiteral(
          replaceLiteral(
            template,
            /<html lang="[^"]*"/,
            `<html lang="${HTML_LANG[locale] ?? locale}" data-locale="${locale}"`,
          ),
          /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,
          seoHead(locale),
        )

      // 根路径保留默认语言（Worker 不在时的兜底），再为每种语言产出一份内部文件 <locale>/index.html
      entry.source = htmlFor(DEFAULT_LOCALE)
      for (const locale of LOCALES) {
        this.emitFile({ type: 'asset', fileName: `${locale}/index.html`, source: htmlFor(locale) })
      }

      this.info(`已生成多语言 HTML：${LOCALES.join(' / ')}`)
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
