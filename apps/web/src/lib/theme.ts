import { useEffect, useState } from 'react'

/**
 * 主题只切换 `<html data-theme>`，颜色全部来自 packages/tokens/app.css 的令牌，
 * 官网不另外定义任何颜色。默认跟随系统，选择记在 localStorage。
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
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  return {
    theme,
    toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
  }
}
