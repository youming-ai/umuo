import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { App } from './App'
import { DEFAULT_LOCALE, localeFromPath } from './lib/router'
import './styles/app.css'

/**
 * 根路径（以及任何不带语言前缀的路径）重定向到 /zh-cn/。
 * 静态托管命中各语言目录时不会走到这里，只有 SPA 回退（/、未知路径）才会。
 */
if (!localeFromPath(window.location.pathname)) {
  window.history.replaceState(null, '', `/${DEFAULT_LOCALE}/${window.location.hash}`)
}

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载点')

const tree = (
  <StrictMode>
    <App />
  </StrictMode>
)

/**
 * 构建产物是预渲染过的（容器里已经有正文），开发服务器与 SPA 回退则是空的。
 *
 * 有内容就必须走 `hydrateRoot`：用 `createRoot` 会把预渲染的 DOM 全部丢掉重渲染，
 * 首屏白闪一次，预渲染也就白做了。
 */
if (container.hasChildNodes()) {
  hydrateRoot(container, tree)
} else {
  createRoot(container).render(tree)
}
