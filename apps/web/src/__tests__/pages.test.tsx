// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { pageFromPath, pagePath } from '../lib/pages'
import { localeHref } from '../lib/router'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal('requestAnimationFrame', vi.fn())
  window.history.replaceState(null, '', '/zh-cn/')
  window.localStorage.clear()
  document.documentElement.dataset.theme = 'dark'
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<App />))
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function click(selector: string) {
  const link = host.querySelector<HTMLElement>(selector)
  if (!link) throw new Error(`找不到 ${selector}`)
  act(() => link.click())
}

describe('首页与定价页导航', () => {
  it('生成有语言前缀的独立页面地址', () => {
    expect(pagePath('en', 'pricing')).toBe('/en/pricing/')
    expect(localeHref('ja', 'pricing', 'pricing')).toBe('/ja/pricing/#pricing')
    expect(pageFromPath('/zh-cn/pricing')).toBe('pricing')
    expect(pageFromPath('/en/')).toBe('home')
  })

  it('产品、定价切换，语言切换仍留在定价页，产品返回主屏', () => {
    click('header nav a[href="/zh-cn/pricing/"]')
    expect(window.location.pathname).toBe('/zh-cn/pricing/')
    expect(host.querySelector('#pricing')).not.toBeNull()
    expect(host.querySelector('#download')).toBeNull()
    expect(host.querySelector('header a[aria-current="page"]')?.textContent).toBe('定价')
    click('footer button[aria-expanded]')
    click('footer a[href="/en/pricing/"]')
    expect(window.location.pathname).toBe('/en/pricing/')
    expect(host.querySelector('#pricing')).not.toBeNull()
    click('header nav a[href="/en/"]')
    expect(window.location.pathname).toBe('/en/')
    expect(window.location.hash).toBe('')
    expect(host.querySelector('#download')).not.toBeNull()
  })

  it('Footer 向上展开五种语言，韩语切换保留定价页并关闭菜单', () => {
    click('header nav a[href="/zh-cn/pricing/"]')
    expect(host.querySelector('footer ul')).toBeNull()
    click('footer button[aria-expanded]')
    const options = host.querySelectorAll('footer ul a')
    expect([...options].map((option) => option.textContent)).toEqual([
      '简体中文',
      '繁體中文',
      'English',
      '日本語',
      '한국어',
    ])
    expect(host.querySelector('footer ul')?.className).toContain('bottom-full')
    click('footer a[href="/ko/pricing/"]')
    expect(window.location.pathname).toBe('/ko/pricing/')
    expect(host.querySelector('#pricing')).not.toBeNull()
    expect(host.querySelector('footer ul')).toBeNull()
    expect(host.querySelector('footer button[aria-expanded]')?.textContent).toContain('한국어')
  })

  it('语言菜单支持 Escape 和点外部关闭', () => {
    click('footer button[aria-expanded]')
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('footer ul')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('footer button[aria-expanded]'))
    click('footer button[aria-expanded]')
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(host.querySelector('footer ul')).toBeNull()
  })

  it('语言和主题只在 Footer，主题选择被保存且跨页面保留', () => {
    expect(host.querySelector('header button[aria-label="主题"]')).toBeNull()
    expect(host.querySelector('header button[aria-label="语言"]')).toBeNull()
    click('footer button[aria-label="主题"]')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem('umuo-theme')).toBe('light')
    expect(host.querySelector('footer button[aria-label="主题"]')?.getAttribute('title')).toBe(
      '切换到深色主题',
    )
    click('header nav a[href="/zh-cn/pricing/"]')
    expect(document.documentElement.dataset.theme).toBe('light')
    click('footer button[aria-label="主题"]')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(host.querySelector('footer button[aria-label="主题"]')?.getAttribute('title')).toBe(
      '切换到浅色主题',
    )
  })

  it('未发布时下载暂不可点击，不再弹出邮箱订阅表单', () => {
    const download = host.querySelector<HTMLButtonElement>('#download .btn-primary')
    expect(download?.disabled).toBe(true)
    expect(host.querySelector<HTMLButtonElement>('header .btn-primary')?.disabled).toBe(true)
    click('#download .btn-primary')
    expect(host.querySelector('form')).toBeNull()
    expect(host.querySelector('input[type="email"]')).toBeNull()
    expect(host.querySelector('#download')?.textContent).not.toContain('上线通知')
  })

  it('定价通知表单使用透明背景，关闭行为不变', () => {
    click('header nav a[href="/zh-cn/pricing/"]')
    click('#pricing .pricing-card button')
    expect(host.querySelector('form')?.closest('section')?.className).toContain('bg-transparent')
    click('#pricing button[aria-label="取消"]')
    expect(host.querySelector('form')).toBeNull()
  })

  it('前进后退的 popstate 更新页面，不留下旧页面内容', () => {
    window.history.replaceState(null, '', '/zh-cn/pricing/')
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(host.querySelector('#pricing')).not.toBeNull()
    window.history.replaceState(null, '', '/zh-cn/')
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(host.querySelector('#pricing')).toBeNull()
    expect(host.querySelector('#download')).not.toBeNull()
  })
})
