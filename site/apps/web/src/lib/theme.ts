import { useEffect, useState } from 'react'
import { withViewTransition } from './transition'

/**
 * 主题只切换 `<html data-theme>`，颜色全部来自 apps/web/src/styles/app.css 的令牌，
 * 官网不另外定义任何颜色。默认跟随系统；只有访客亲手切换过，选择才记进 localStorage——
 * 挂载时不写，否则「跟随系统」会被固化成一次显式选择，之后系统换了深浅色页面也不跟。
 */
export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'umuo-theme'

function readInitialTheme(): Theme {
  // 服务端渲染时没有 localStorage / matchMedia。回落暗色，与 index.html 里
  // <html data-theme="dark"> 的初始值一致，保证预渲染产物本身是自洽的。
  if (typeof window === 'undefined') return 'dark'

  // 浏览器里优先读 <html data-theme>：index.html 的同步脚本已经在首屏前定好了它，
  // 从这里取值可以避免「先渲染成另一个主题、再被 effect 纠正」的闪烁。
  const applied = document.documentElement.dataset.theme
  if (applied === 'light' || applied === 'dark') return applied

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    // 两套配色之间做一次短交叉淡化；<html data-theme> 在过渡回调里直接写，不等 effect
    withViewTransition(() => {
      document.documentElement.dataset.theme = next
      setTheme(next)
    })
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 隐私模式等存不了时，这次访问内照样生效，只是下次不记得
    }
  }

  return { theme, toggleTheme }
}
