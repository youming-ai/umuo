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
    // 「免费与开源」页已删除：旧地址不再是站内页面（Worker 会 301 回 /）
    expect(pageFromPath('/pricing')).toBe('home')
    expect(pageFromPath('/zh-cn/pricing')).toBe('home')
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

  it('页眉左边 logo、右边 GitHub，没有「免费与开源」链接与下载按钮', () => {
    const links = [...(host.querySelector('header')?.querySelectorAll('a') ?? [])]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      'https://github.com/youming-ai/umuo',
    ])
    expect(links[1]?.textContent).toBe('GitHub')
    expect(host.querySelector('header a[href*="pricing"]')).toBeNull()
    expect(host.querySelector('header')?.textContent).not.toContain('免费与开源')
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
    // 下载按钮旁不再放说明句；源码链接在页眉右侧与页脚
    expect(host.querySelector('#download a[href*="github.com"]')).toBeNull()
    expect(host.querySelector('footer a[href="https://github.com/youming-ai/umuo"]')).not.toBeNull()
    expect(host.querySelector('a[href*="pricing"]')).toBeNull()
  })
})

describe('已删除的页面', () => {
  it('旧的激活页地址不再是站内页面，按首页渲染', () => {
    expect(pageFromPath('/activate')).toBe('home')
  })
})
