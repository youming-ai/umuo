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

  it('页眉左边 logo、右边定价，没有下载按钮', () => {
    const links = [...(host.querySelector('header')?.querySelectorAll('a') ?? [])]
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/pricing'])
    expect(links[1]?.textContent).toBe('定价')
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
    expect(host.querySelector('#download')?.textContent).not.toContain('购买 US$9')
  })
})

describe('定价与激活', () => {
  beforeEach(() => window.sessionStorage.clear())

  function renderAt(path: string) {
    act(() => root.unmount())
    window.history.replaceState(null, '', path)
    root = createRoot(host)
    act(() => root.render(<App />))
  }

  /** 让轮询里的 fetch 与 setState 都跑完 */
  const settle = () => act(async () => {})

  it('定价页：两笔账（付给 umuo US$9 / 付给模型供应商），尚未开放购买时只放下载按钮与一句说明', () => {
    renderAt('/pricing')
    const pages = [...host.querySelectorAll('.pricing-page')]
    expect(pages.map((page) => page.querySelector('h2')?.textContent)).toEqual([
      '付给 umuo',
      '付给模型供应商',
    ])
    expect(pages[0]?.querySelector('a[href="/download/macos"]')).not.toBeNull()
    expect(pages[0]?.textContent).toContain('正式购买尚未开放')
    expect(host.querySelector('form')).toBeNull()
    // 购买开关（config.ts 的 PURCHASE_OPEN）默认关闭：没有购买按钮，商业规则照常写明
    expect(host.textContent).not.toContain('购买 US$9')
    expect(pages[0]?.textContent).toContain('3 台 Mac')
    expect(pages[0]?.textContent).toContain('14 天内可退款')
    // 包含清单配默认快捷键；没发布的功能只标状态、不给键位
    expect(pages[0]?.querySelector('.pricing-amount')?.textContent).toBe('US$9')
    expect(host.querySelectorAll('.pricing-excluded li').length).toBeGreaterThan(0)
    const rows = [...host.querySelectorAll('.pricing-features li')]
    expect(rows[0]?.querySelectorAll('kbd')).toHaveLength(2)
    expect(rows.find((row) => row.querySelector('.tag'))?.querySelector('kbd')).toBeFalsy()
    // 订阅时代的承诺不能留在页面上
    const text = host.textContent ?? ''
    for (const stale of ['Premium', '月付', '年付', '订阅费']) expect(text).not.toContain(stale)
  })

  it('激活页：拿到密钥后显示密钥与 umuo:// 深链接', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ licenseKey: 'UMUO-ABCDE-FGHJK-MNPQR-STVWX' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/activate?claim=c1')
    await settle()
    expect(fetchMock).toHaveBeenCalledWith('/api/license/claim?claim=c1')
    expect(host.querySelector('main code')?.textContent).toBe('UMUO-ABCDE-FGHJK-MNPQR-STVWX')
    expect(host.querySelector('a[href^="umuo://activate"]')?.getAttribute('href')).toBe(
      'umuo://activate?key=UMUO-ABCDE-FGHJK-MNPQR-STVWX',
    )
    // 领取码是拿密钥的凭证：读到就从地址栏抹掉，不留在浏览器历史里
    expect(window.location.search).toBe('')
  })

  it('激活页：刷新后（地址里已没有领取码）从本标签页存下的继续', async () => {
    window.sessionStorage.setItem('umuo-claim', 'c2')
    const fetchMock = vi.fn(async () => Response.json({ status: 'pending' }))
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/activate')
    await settle()
    expect(fetchMock).toHaveBeenCalledWith('/api/license/claim?claim=c2')
  })

  it('激活页：一次网络抖动不会停止轮询，退避后重试拿到密钥', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('network'))
        .mockResolvedValueOnce(Response.json({ licenseKey: 'UMUO-ABCDE-FGHJK-MNPQR-STVWX' }))
      vi.stubGlobal('fetch', fetchMock)
      renderAt('/activate?claim=c3')
      await settle()
      expect(host.querySelector('main code')).toBeNull()
      await act(async () => vi.advanceTimersByTime(2000))
      await settle()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(host.querySelector('main code')?.textContent).toBe('UMUO-ABCDE-FGHJK-MNPQR-STVWX')
    } finally {
      vi.useRealTimers()
    }
  })

  it('激活页：地址里没有领取码时不请求，直接说明', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/activate')
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(host.querySelector('main')?.textContent).toContain('地址不完整')
  })

  it('激活页：领取码不存在或过期时给出联系方式', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: false }, { status: 404 })),
    )
    renderAt('/activate?claim=gone')
    await settle()
    expect(host.querySelector('main')?.textContent).toContain('已过期')
    expect(host.querySelector('main code')).toBeNull()
  })
})
