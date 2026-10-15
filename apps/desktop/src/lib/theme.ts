import { api, onThemeChanged } from './ipc'

/**
 * 客户端主题（PRD §7.3 通用：浅色 / 深色 / 跟随系统）。
 *
 * 与官网的 `lib/theme.ts` 是两套：官网要预渲染，只能 light/dark 且把选择放在
 * localStorage；客户端是多窗口常驻进程，主题存在**设置文件**里（这样四个窗口
 * 看到的是同一套），并且多了一个高对比度——PRD §8 的可访问性要求它。
 *
 * 颜色全部来自 `packages/tokens/app.css` 的令牌，这里只切换 `<html data-theme>`。
 */

export type ThemeChoice = 'system' | 'light' | 'dark' | 'highContrast'

/** 令牌里真实存在的主题名（`data-theme` 的取值）。 */
export type ResolvedTheme = 'light' | 'dark' | 'high-contrast'

export const THEME_CHOICES: Array<[ThemeChoice, string]> = [
  ['system', '跟随系统'],
  ['light', '浅色'],
  ['dark', '深色'],
  ['highContrast', '高对比度'],
]

/**
 * 把用户的选择解析成真正要应用的主题名。
 *
 * 纯函数：`prefersDark` 由调用方从系统读，这样「跟随系统」这条规则可以测。
 * 认不出来的选择一律回落「跟随系统」——手改过的设置文件不该让界面变白。
 */
export function resolveTheme(choice: string, prefersDark: boolean): ResolvedTheme {
  switch (choice) {
    case 'light':
      return 'light'
    case 'dark':
      return 'dark'
    case 'highContrast':
      return 'high-contrast'
    default:
      return prefersDark ? 'dark' : 'light'
  }
}

/** 当前系统是否偏好深色。无 matchMedia 时按深色算（与令牌默认值一致）。 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(resolved: ResolvedTheme, root = document.documentElement): void {
  root.dataset.theme = resolved
}

/**
 * 应用主题并保持同步，返回停止函数。
 *
 * 两件事要跟着变：系统主题（当选的是「跟随系统」时）与**设置里改了主题**。
 * 后者靠 Rust 侧广播 `settings://theme`——四个窗口里就浮窗是常驻的，
 * 不广播的话用户改完主题会以为"没生效"，直到下次重启。
 */
export function startThemeSync(choice: string): () => void {
  let current = choice
  const render = () => applyTheme(resolveTheme(current, systemPrefersDark()))
  render()

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  // 只在「跟随系统」时需要监听：否则系统换主题会把用户明选的主题顶掉。
  const onSystemChange = () => {
    if (current === 'system' || !THEME_CHOICES.some(([id]) => id === current)) render()
  }
  media.addEventListener('change', onSystemChange)

  let dispose: (() => void) | undefined
  let cancelled = false
  void onThemeChanged((theme) => {
    current = theme
    render()
  }).then((unlisten) => {
    if (cancelled) unlisten()
    else dispose = unlisten
  })

  return () => {
    cancelled = true
    media.removeEventListener('change', onSystemChange)
    dispose?.()
  }
}

/** 读设置里的主题并开始同步。各窗口入口在挂载前调用一次。 */
export async function initTheme(): Promise<void> {
  try {
    const settings = await api.getSettings()
    startThemeSync(settings.theme)
  } catch {
    // 读不到设置也要有个能看的界面：按系统主题来。
    startThemeSync('system')
  }
}
