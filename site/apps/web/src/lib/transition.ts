import { flushSync } from 'react-dom'

/**
 * 切换主题 / 语言这类「整页换一套」的更新，用 View Transitions 做一次短交叉淡化（时长在 app.css）。
 * 浏览器不支持、或访客要求减少动态效果时，照原样同步执行——结果相同，只是没有淡化。
 * `update` 里的 React 状态更新会被 flushSync 同步刷到 DOM，浏览器才拍得到新画面。
 */
export function withViewTransition(update: () => void): void {
  // 旧浏览器没有这个方法（类型库里它是必有的，所以按「可能没有」来读）
  const start: typeof document.startViewTransition | undefined = document.startViewTransition
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (typeof start !== 'function' || reduced) {
    update()
    return
  }
  start.call(document, () => flushSync(update))
}
