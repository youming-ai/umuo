// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageGrid } from '../components/LanguageGrid'

function mount({ reduced = false, fine = true } = {}) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion') ? reduced : fine,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const host = document.createElement('section')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<LanguageGrid />))
  const grid = host.querySelector<HTMLElement>('.language-grid')
  if (!grid) throw new Error('语言网格未挂载')
  return { host, root, grid, frames }
}

function move(host: HTMLElement, x = 120, y = 80) {
  host.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('多语言首屏背景', () => {
  it('预渲染字符固定，装饰层不进入无障碍树', () => {
    const html = renderToString(<LanguageGrid />)
    expect(html).toBe(renderToString(<LanguageGrid />))
    expect(html).toContain('aria-hidden="true"')
    expect(html.match(/<span/g)).toHaveLength(256)
  })

  it('移动按帧合并并使用最新位置，离开时熄灭，卸载后移除监听', () => {
    const { host, root, grid, frames } = mount()
    move(host)
    move(host, 180, 90)
    expect(frames).toHaveLength(1)
    frames[0](0)
    expect(grid.style.getPropertyValue('--grid-x')).toBe('180px')
    expect(grid.style.getPropertyValue('--grid-y')).toBe('90px')
    expect(grid.style.getPropertyValue('--grid-active')).toBe('1')
    host.dispatchEvent(new Event('pointerleave'))
    expect(grid.style.getPropertyValue('--grid-active')).toBe('0')
    act(() => root.unmount())
    move(host)
    expect(frames).toHaveLength(1)
  })

  for (const preference of [{ reduced: true }, { fine: false }]) {
    it(`静态模式不安排动画：${JSON.stringify(preference)}`, () => {
      const { host, root, frames } = mount(preference)
      move(host)
      expect(frames).toHaveLength(0)
      act(() => root.unmount())
    })
  }
})
