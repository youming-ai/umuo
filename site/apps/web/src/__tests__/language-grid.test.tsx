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

describe('多语言全屏背景', () => {
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

  it('大视口和窗口缩放都补齐网格，不再限制为 16 列 8 行', () => {
    vi.stubGlobal('innerWidth', 2560)
    vi.stubGlobal('innerHeight', 1440)
    const { grid, root } = mount()
    const rows = () => grid.querySelectorAll('.language-grid-base .language-grid-cells > div')
    expect(rows()).toHaveLength(15)
    expect(rows()[0].children).toHaveLength(27)
    expect(grid.querySelectorAll('.language-grid-base span')).toHaveLength(27 * 15)
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 844)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(rows()).toHaveLength(9)
    expect(rows()[0].children).toHaveLength(5)
    expect(grid.querySelectorAll('.language-grid-base span')).toHaveLength(5 * 9)
    act(() => root.unmount())
  })

  it('按视口增删行列时，已有格子的字不变（位置只由行列决定，hydrate 不重排）', () => {
    const glyphs = (grid: HTMLElement) =>
      [...grid.querySelectorAll('.language-grid-base .language-grid-cells > div')].map((row) =>
        [...row.children].map((cell) => cell.textContent),
      )
    vi.stubGlobal('innerWidth', 1536)
    vi.stubGlobal('innerHeight', 768)
    const { grid, root } = mount()
    const before = glyphs(grid)
    expect(before).toHaveLength(8)
    expect(before[0]).toHaveLength(16)
    vi.stubGlobal('innerWidth', 1280)
    vi.stubGlobal('innerHeight', 720)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(glyphs(grid)).toEqual(before.map((row) => row.slice(0, 14)))
    vi.stubGlobal('innerWidth', 1920)
    vi.stubGlobal('innerHeight', 1080)
    act(() => window.dispatchEvent(new Event('resize')))
    const after = glyphs(grid)
    expect(after).toHaveLength(12)
    expect(after.slice(0, 8).map((row) => row.slice(0, 16))).toEqual(before)
    act(() => root.unmount())
  })

  it('首屏之外的页面内容也能触发聚光', () => {
    const { host, grid, root, frames } = mount()
    const footer = document.createElement('footer')
    host.append(footer)
    footer.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 240, clientY: 600 }),
    )
    frames[0](0)
    expect(grid.style.getPropertyValue('--grid-y')).toBe('600px')
    expect(grid.style.getPropertyValue('--grid-active')).toBe('1')
    act(() => root.unmount())
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
