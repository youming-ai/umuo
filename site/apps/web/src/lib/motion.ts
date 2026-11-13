import type { CSSProperties } from 'react'

/**
 * 进场的错开序号：写在元素上，app.css 里乘 `--stagger` 得到延迟（rise-in、step-in）。
 * 自定义属性会继承，所以每个要进场的元素都显式写自己的序号，不要指望默认值。
 */
export function enterIndex(index: number): CSSProperties {
  return { '--enter-i': index } as CSSProperties
}
