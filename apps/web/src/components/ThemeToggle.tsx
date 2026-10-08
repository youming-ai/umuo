import type { NavContent } from '../content/types'
import type { Theme } from '../lib/theme'
import { ThemeContrastIcon } from './icons'

/** 固定图标结构，避免预渲染主题未知时造成 hydration 不一致。 */
export function ThemeToggle({
  theme,
  onToggleTheme,
  labels,
}: {
  theme: Theme
  onToggleTheme: () => void
  labels: NavContent
}) {
  return (
    <button
      type="button"
      onClick={onToggleTheme}
      className="btn-ghost h-9 w-9 min-w-9 p-0"
      aria-label={labels.themeLabel}
      title={theme === 'dark' ? labels.themeToLight : labels.themeToDark}
      suppressHydrationWarning
    >
      <ThemeContrastIcon className="h-[18px] w-[18px]" />
    </button>
  )
}
