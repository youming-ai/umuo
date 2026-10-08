import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { App } from './App'
import { localeFromPath, switchLocale } from './lib/router'
import './styles/app.css'

/**
 * 地址里不保留语言前缀。线上 Worker 会把 `/en/` 这类旧地址 301 到 `/`；
 * 没有 Worker 的情况（本地开发、纯静态托管）在这里兜底：记住语言，再把地址换回 `/`。
 */
const pathLocale = localeFromPath(window.location.pathname)
if (pathLocale) {
  switchLocale(pathLocale)
  window.history.replaceState(null, '', `/${window.location.hash}`)
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
