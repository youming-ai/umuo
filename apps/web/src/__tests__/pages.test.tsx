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
  window.history.replaceState(null, '', '/')
  document.documentElement.dataset.locale = 'zh-cn'
  // biome-ignore lint/suspicious/noDocumentCookie: 清掉上一个用例留下的语言 cookie
  document.cookie = 'umuo-lang=; max-age=0; path=/'
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

describe('首页一屏', () => {
  it('地址永远是 /，不带语言前缀', () => {
    expect(pagePath('en')).toBe('/')
    expect(localeHref('ja', 'download')).toBe('/#download')
    expect(pageFromPath('/zh-cn/pricing')).toBe('home')
    expect(pageFromPath('/en/')).toBe('home')
  })

  it('页眉左边 logo、右边 GitHub，没有导航链接和下载按钮', () => {
    const links = [...(host.querySelector('header')?.querySelectorAll('a') ?? [])]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      'https://github.com/youming-ai/umuo',
    ])
    expect(links[1]?.getAttribute('target')).toBe('_blank')
    expect(links[1]?.getAttribute('rel')).toBe('noreferrer')
    expect(host.querySelector('header button')).toBeNull()
  })

  it('演示可以点击切换，也可以直接按快捷键', () => {
    const pressed = () => host.querySelector('.demo-switch [aria-pressed="true"]')?.textContent
    expect(pressed()).toContain('划词翻译')
    click('.demo-switch button:nth-child(2)')
    expect(pressed()).toContain('原地替换')
    const key = (type: string, init: KeyboardEventInit) =>
      act(() => window.dispatchEvent(new KeyboardEvent(type, init)))
    key('keydown', { code: 'KeyD', altKey: true })
    expect(pressed()).toContain('划词翻译')
    key('keydown', { code: 'KeyT', altKey: true, shiftKey: true })
    expect(pressed()).toContain('原地替换')
    // 单独按一下右 ⌥ 才算「按住说话」；中间按了别的键就不算
    key('keydown', { code: 'AltRight', altKey: true })
    key('keydown', { code: 'KeyD', altKey: true })
    key('keyup', { code: 'AltRight' })
    expect(pressed()).toContain('划词翻译')
    key('keydown', { code: 'AltRight', altKey: true })
    key('keyup', { code: 'AltRight' })
    expect(pressed()).toContain('语音输入')
  })

  it('Footer 向上展开五种语言，切换后关闭菜单', () => {
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
    click('footer a[href="/ko/"]')
    // 就地切换：地址不变，语言记进 cookie 给 Worker 下次用
    expect(window.location.pathname).toBe('/')
    expect(document.documentElement.dataset.locale).toBe('ko')
    expect(document.cookie).toContain('umuo-lang=ko')
    expect(host.querySelector('h1')?.textContent).toContain('번역')
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

  it('主题切换只在 Footer，选择会被保存', () => {
    expect(host.querySelector('header button[aria-label="主题"]')).toBeNull()
    click('footer button[aria-label="主题"]')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem('umuo-theme')).toBe('light')
    expect(host.querySelector('footer button[aria-label="主题"]')?.getAttribute('title')).toBe(
      '切换到深色主题',
    )
    click('footer button[aria-label="主题"]')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('下载按钮指向 Worker 给出的最新安装包，带预览版标签与放行说明', () => {
    const download = host.querySelector<HTMLAnchorElement>('#download a.btn-primary')
    expect(download?.getAttribute('href')).toBe('/download/macos')
    expect(download?.textContent).toContain('预览版')
    expect(host.querySelector('#download')?.textContent).toContain('仍要打开')
    expect(host.querySelector('form')).toBeNull()
  })
})
