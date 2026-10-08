import { renderToString } from 'react-dom/server'

import { App } from './App'
import type { Locale } from './content/types'
import { setInitialRouteForSsr } from './lib/router'

/**
 * 预渲染入口。**只被构建期脚本使用**，不参与浏览器运行时。
 *
 * 它的存在是为了让 `dist/<locale>/index.html` 里带上真正的正文，而不是一个空的
 * `<div id="root">`——否则禁 JS 的访客、以及不执行 JS 的抓取工具（部分社交平台
 * 预览、部分 SEO 工具）看到的是一片空白。
 *
 * 客户端与服务端共用同一个 `App`：语言通过 [`setInitialRouteForSsr`] 注入，
 * 而不是为 SSR 复制一份组件树——两份实现必然漂移。
 */
export function render(locale: Locale): string {
  setInitialRouteForSsr({ locale, hash: '' })
  return renderToString(<App />)
}
