import { type Locale, resolveLocale, setLocale } from './i18n'
import { api, onLocaleChanged, onScaleChanged, onThemeChanged } from './ipc'
import { applyTheme, resolveTheme, systemPrefersDark } from './theme'

/**
 * 各窗口入口在挂载前调用一次：把主题、界面语言与缩放定下来，并跟着设置变化同步。
 *
 * 为什么合并成一个入口：六个窗口各自 `createRoot`，两边各写一遍
 * 「读设置 → 应用 → 订阅广播」有十二处会漏；合成一个之后入口只有一行。
 *
 * **必须在首屏渲染前调用**：否则会先渲染成默认主题/默认语言、再被纠正，
 * 用户看到的是闪一下。
 */
export async function initUi(): Promise<void> {
  let theme = 'system'
  let locale = 'system'
  let scale = 1
  try {
    const settings = await api.getSettings()
    theme = settings.theme
    locale = settings.locale
    scale = settings.uiScale
  } catch {
    // 读不到设置也要有个能看的界面：按系统主题与系统语言来。
  }

  applyScale(scale)
  const resolved: Locale = resolveLocale(locale, systemLanguages())
  setLocale(resolved)
  applyTheme(resolveTheme(theme, systemPrefersDark()))

  // 系统偏好变化：只有「跟随系统」时才理会，否则会把用户明选的值顶掉。
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme(resolveTheme(theme, systemPrefersDark()))
  })

  void onThemeChanged((next) => {
    theme = next
    applyTheme(resolveTheme(theme, systemPrefersDark()))
  })
  void onLocaleChanged((next) => {
    locale = next
    setLocale(resolveLocale(locale, systemLanguages()))
  })
  void onScaleChanged((next) => applyScale(next))
}

/**
 * 把缩放应用到当前窗口。
 *
 * `setZoom` 在 **Webview** 上（`getCurrentWindow` 返回的 Window 没有这个方法），
 * 作用对象是整个 WebView 的页面缩放——正是「界面缩放」想要的。
 */
export function applyScale(scale: number): void {
  // 不在 Tauri 里（比如直接用浏览器打开构建产物）就无事可做。
  // 注意只查 `__TAURI_INTERNALS__` 存在还不够：getCurrentWebview() 还会读
  // `metadata.currentWindow`，桩环境里没有它照样抛错（本仓库为此多跑了一轮夹具）。
  const internals = (window as { __TAURI_INTERNALS__?: { metadata?: unknown } }).__TAURI_INTERNALS__
  if (!internals?.metadata) return
  void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
    getCurrentWebview()
      .setZoom(scale)
      .catch(() => {}),
  )
}

/** 系统语言偏好。`navigator.languages` 在 WebView 里拿得到。 */
function systemLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  const list = navigator.languages
  if (list && list.length > 0) return [...list]
  return navigator.language ? [navigator.language] : []
}
