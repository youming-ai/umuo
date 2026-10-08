/**
 * 把预渲染出来的正文注入到官网各语言的静态页里。
 *
 * 流程（见 apps/web/package.json 的 build 脚本）：
 * 1. `vite build` — 产出客户端产物，并按语言生成 `dist/<locale>/index.html`（head 已就位）
 * 2. `vite build --ssr src/entry-server.tsx` — 产出预渲染用的服务端 bundle
 * 3. 本脚本 — 每种语言渲染一次，塞进对应 HTML 的 `<div id="root">` 里
 *
 * 为什么走 Vite 的 SSR 构建、而不是直接 `bun run` 一个渲染脚本：组件树里有 TSX 与
 * 路径别名，Vite 的构建管线能原样处理。渲染入口里没有 CSS 导入，所以不涉及样式抽取。
 *
 * 放在根 `scripts/` 而不是 `apps/web/scripts/`：这里的 tsconfig 已经带上了
 * node + bun 类型（脚本用了 `import.meta.dirname` 与 Bun 的 API），
 * 放回 app 目录就得再配一份类型，没必要。
 *
 * 运行：bun run scripts/prerender-web.ts（通常由 apps/web 的 build 脚本调用）
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { LOCALES } from '../apps/web/src/config'
import type { Locale } from '../apps/web/src/content/types'

const WEB_DIR = join(import.meta.dirname, '..', 'apps/web')
const DIST = join(WEB_DIR, 'dist')
const SSR_BUNDLE = join(WEB_DIR, 'dist-ssr/entry-server.js')

/** 与 index.html 里的挂载点**逐字**对应。改了一边就要改另一边，所以这里直接断言。 */
const MOUNT_MARKER = '<div id="root"></div>'

const { render } = (await import(SSR_BUNDLE)) as {
  render: (locale: Locale) => string
}

const targets: Array<{ file: string; locale: Locale }> = [
  // 根路径是 SPA 回退的入口，main.tsx 会把它重定向到默认语言，所以按默认语言预渲染
  { file: join(DIST, 'index.html'), locale: LOCALES[0] },
  ...LOCALES.map((locale) => ({ file: join(DIST, locale, 'index.html'), locale })),
]

let done = 0
for (const { file, locale } of targets) {
  const html = readFileSync(file, 'utf8')
  if (!html.includes(MOUNT_MARKER)) {
    throw new Error(`${file} 里找不到挂载点 ${MOUNT_MARKER}——index.html 或构建插件的产物格式变了`)
  }

  const body = render(locale)
  // 空正文说明 SSR 静默失败了（比如某个组件在服务端抛错被吞掉）。
  // 不检查的话会产出一个「构建成功但页面全白」的站点——这是最糟的失败形态。
  if (body.trim().length < 1000) {
    throw new Error(`${locale} 的预渲染正文只有 ${body.length} 字符，明显不对`)
  }

  writeFileSync(file, html.replace(MOUNT_MARKER, `<div id="root">${body}</div>`))
  done++
  console.log(
    `  预渲染 ${locale.padEnd(6)} 正文 ${String(body.length).padStart(7)} 字符 → ${file.replace(`${WEB_DIR}/`, '')}`,
  )
}

console.log(`\n共预渲染 ${done} 个页面（含根路径）。`)
