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
  vi.restoreAllMocks()
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
    expect(pageFromPath('/zh-cn/faq')).toBe('home')
    expect(pageFromPath('/zh-cn/pricing')).toBe('pricing')
    expect(pageFromPath('/en/')).toBe('home')
    expect(pagePath('ja', 'terms')).toBe('/terms')
    expect(pageFromPath('/privacy')).toBe('privacy')
    expect(pageFromPath('/en/terms/')).toBe('terms')
  })

  it('页脚链到服务条款与隐私政策', () => {
    const hrefs = [...host.querySelectorAll('footer a')].map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/terms')
    expect(hrefs).toContain('/privacy')
  })

  it('页眉左边 logo、右边「免费与开源」，没有下载按钮', () => {
    const links = [...(host.querySelector('header')?.querySelectorAll('a') ?? [])]
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/pricing'])
    expect(links[1]?.textContent).toBe('免费与开源')
    expect(host.querySelector('header button')).toBeNull()
  })

  it('演示可以点击切换，也可以直接按快捷键', () => {
    const pressed = () => host.querySelector('.demo-tabs [aria-selected="true"]')?.textContent
    // 默认停在第一项划词翻译
    expect(pressed()).toContain('划词翻译')
    // 标准选项卡：只有当前一项可以 Tab 进入，提示随模式变化
    expect(host.querySelectorAll('.demo-tabs [tabindex="0"]')).toHaveLength(1)
    expect(host.querySelector('.demo-hint')?.textContent).toContain('⌃')
    click('.demo-tabs [role="tab"]:nth-child(2)')
    expect(pressed()).toContain('闪电替换')
    expect(host.querySelector('.demo-hint')?.textContent).toContain('⌥')
    expect(host.querySelector('.demo-field-replace')?.textContent).toContain('明天下午三点')
    // ←/→ 在选项卡之间循环切换
    const arrow = (k: string) =>
      act(() =>
        host
          .querySelector('.demo-tabs [aria-selected="true"]')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })),
      )
    arrow('ArrowLeft')
    expect(pressed()).toContain('划词翻译')
    arrow('ArrowLeft')
    expect(pressed()).toContain('语音输入')
    arrow('Home')
    expect(pressed()).toContain('划词翻译')
    click('.demo-tabs [role="tab"]:nth-child(3)')
    expect(pressed()).toContain('截图翻译')
    expect(host.querySelector('.demo-shot')?.textContent).toContain('Platform 2')
    click('.demo-tabs [role="tab"]:nth-child(2)')
    const key = (type: string, init: KeyboardEventInit) =>
      act(() => window.dispatchEvent(new KeyboardEvent(type, init)))
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const tap = (code: string, flag: 'ctrlKey' | 'altKey') => {
      key('keydown', { code, [flag]: true })
      now += 60
      key('keyup', { code })
      now += 100
    }
    tap('ControlLeft', 'ctrlKey')
    tap('ControlLeft', 'ctrlKey')
    expect(pressed()).toContain('划词翻译')
    tap('AltLeft', 'altKey')
    tap('AltLeft', 'altKey')
    expect(pressed()).toContain('闪电替换')
    // 左 ⌃ 接右 ⌃、中间按了别的键，都不算连按
    tap('ControlLeft', 'ctrlKey')
    tap('ControlRight', 'ctrlKey')
    tap('ControlLeft', 'ctrlKey')
    key('keydown', { code: 'KeyC' })
    tap('ControlLeft', 'ctrlKey')
    expect(pressed()).toContain('闪电替换')
    // 按住修饰键不切换模式：语音（⌃⌘V）与截图一样只能点选项卡
    key('keydown', { code: 'AltRight', altKey: true })
    now += 400
    key('keyup', { code: 'AltRight' })
    expect(pressed()).toContain('闪电替换')
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
    // 购买开关默认关闭：首页下载区不出现购买按钮
    // 下载按钮旁只有一句「免费、自带 Key」；仓库公开前（SOURCE_PUBLIC 关闭）没有源码链接
    expect(host.querySelector('.hero-pricing-link')?.textContent).toBe('免费，自带 Key，即将开源')
    expect(host.querySelector('a[href*="github.com"]')).toBeNull()
  })
})

describe('免费与开源', () => {
  function renderAt(path: string) {
    act(() => root.unmount())
    window.history.replaceState(null, '', path)
    root = createRoot(host)
    act(() => root.render(<App />))
  }

  it('/pricing：umuo 免费、模型费用付给供应商，没有购买入口与源码链接', () => {
    renderAt('/pricing')
    expect(host.querySelector('h1')?.textContent).toBe('免费与开源')
    const pages = [...host.querySelectorAll('.pricing-page')]
    expect(pages.map((page) => page.querySelector('h2')?.textContent)).toEqual([
      '付给 umuo',
      '付给模型供应商',
    ])
    expect(pages[0]?.querySelector('.pricing-amount')?.textContent).toBe('免费')
    expect(pages[0]?.querySelector('a[href="/download/macos"]')).not.toBeNull()
    expect(host.querySelector('form')).toBeNull()
    // SOURCE_PUBLIC 默认关闭：只写「即将公开」，整页（含页脚）不出现源码链接
    expect(host.querySelector('.pricing-source')?.textContent).toContain('MIT')
    expect(host.querySelector('.pricing-source a')).toBeNull()
    expect(host.querySelector('a[href*="github.com"]')).toBeNull()
    // 包含清单配默认快捷键；没发布的功能只标状态、不给键位
    expect(host.querySelectorAll('.pricing-excluded li').length).toBeGreaterThan(0)
    const rows = [...host.querySelectorAll('.pricing-features li')]
    expect(rows[0]?.querySelectorAll('kbd')).toHaveLength(2)
    expect(rows.find((row) => row.querySelector('.tag'))?.querySelector('kbd')).toBeFalsy()
    // 收费时代的承诺不能留在页面上（「没有试用期、许可证或激活步骤」这句否定说明除外）
    const text = host.textContent ?? ''
    for (const stale of ['US$9', '购买', '免费试用', '退款', '3 台', '许可证密钥'])
      expect(text).not.toContain(stale)
  })

  it('旧的激活页地址不再是站内页面，按首页渲染', () => {
    expect(pageFromPath('/activate')).toBe('home')
  })
})
