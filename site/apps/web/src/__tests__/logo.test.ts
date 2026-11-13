import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * 取出一段 SVG / JSX 里的全部图形元素，属性名归一化（stroke-width 与 strokeWidth 视为同一个）。
 * clipPath 的 id 与引用两边写法不同（页面里要避免重名），不参与比较。
 */
function shapes(source: string) {
  return [...source.matchAll(/<(rect|circle|ellipse|path)\b([^>]*?)\/?>/g)].map(
    ([, tag, attrs]) => ({
      tag,
      attrs: Object.fromEntries(
        [...attrs.matchAll(/([A-Za-z-]+)="([^"]*)"/g)].map(([, name, value]) => [
          name.replaceAll('-', '').toLowerCase(),
          value,
        ]),
      ),
    }),
  )
}

describe('logo', () => {
  it('页眉的 LogoMark 与 favicon.svg 是同一张图', () => {
    const icons = read('../components/icons.tsx')
    const logoMark = icons.slice(
      icons.indexOf('export function LogoMark'),
      icons.indexOf('export function DownloadIcon'),
    )
    const favicon = shapes(read('../../public/favicon.svg'))

    expect(favicon.length).toBeGreaterThan(20)
    expect(shapes(logoMark)).toEqual(favicon)
  })
})
