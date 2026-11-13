import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** 取出一段 SVG / JSX 里的取景框与全部路径数据 */
function geometry(source: string) {
  return {
    viewBox: source.match(/viewBox="([^"]+)"/)?.[1],
    paths: [...source.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]),
    strokeWidth: source.match(/stroke-?[wW]idth="([^"]+)"/)?.[1],
  }
}

describe('logo', () => {
  it('页眉的 LogoMark 与 favicon.svg 是同一张图', () => {
    const icons = read('../components/icons.tsx')
    const logoMark = icons.slice(
      icons.indexOf('export function LogoMark'),
      icons.indexOf('export function DownloadIcon'),
    )
    const favicon = geometry(read('../../public/favicon.svg'))

    expect(favicon.paths).toHaveLength(2)
    expect(geometry(logoMark)).toEqual(favicon)
  })
})
