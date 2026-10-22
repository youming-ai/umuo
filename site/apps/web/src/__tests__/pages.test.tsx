// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { CheckoutForm } from '../components/PricingPage'
import { getContent } from '../content'
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
    const pressed = () => host.querySelector('.demo-switch [aria-pressed="true"]')?.textContent
    expect(pressed()).toContain('划词翻译')
    click('.demo-switch button:nth-child(2)')
    expect(pressed()).toContain('原地替换')
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
    expect(pressed()).toContain('原地替换')
    // 左 ⌃ 接右 ⌃、中间按了别的键，都不算连按
    tap('ControlLeft', 'ctrlKey')
    tap('ControlRight', 'ctrlKey')
    tap('ControlLeft', 'ctrlKey')
    key('keydown', { code: 'KeyC' })
    tap('ControlLeft', 'ctrlKey')
    expect(pressed()).toContain('原地替换')
    // 按住右 ⌥ 才是「按住说话」
    key('keydown', { code: 'AltRight', altKey: true })
    now += 400
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

  it('定价页：Free 放下载按钮，Premium 写明月付与年付；结账没开放时只放一句说明', () => {
    renderAt('/pricing')
    const plans = [...host.querySelectorAll('.pricing-plans > li')]
    expect(plans.map((plan) => plan.querySelector('h2')?.textContent)).toEqual(['Free', 'Premium'])
    expect(plans[0]?.querySelector('a[href="/download/macos"]')).not.toBeNull()
    expect(plans[1]?.textContent).toContain('$2.99')
    expect(plans[1]?.textContent).toContain('$29.90')
    expect(plans[1]?.querySelector('form')).toBeNull()
    expect(plans[1]?.textContent).toContain('即将开放购买')
    // 「在本页购买」「在客户端里管理订阅」这些说明在结账开放之前不成立，不显示
    const notes = host.querySelector('.pricing-notes')?.textContent ?? ''
    expect(notes).not.toContain('怎么购买')
    expect(notes).toContain('退款')
  })

  it('激活页：拿到密钥后显示密钥与 umuo:// 深链接', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, status: 'ready', key: 'UMUO-ABCDE-FGHJK-MNPQR-STVWX' }),
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
    const fetchMock = vi.fn(async () => Response.json({ ok: true, status: 'pending' }))
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
        .mockResolvedValueOnce(
          Response.json({ ok: true, status: 'ready', key: 'UMUO-ABCDE-FGHJK-MNPQR-STVWX' }),
        )
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

describe('结账表单（CHECKOUT_ENABLED 打开后的行为）', () => {
  const checkout = getContent('zh-cn').pricing.checkout

  function mountForm() {
    act(() => root.render(<CheckoutForm checkout={checkout} />))
    const input = host.querySelector<HTMLInputElement>('input[type="email"]')
    if (!input) throw new Error('找不到邮箱输入框')
    // React 受控输入：走原生 setter 再派发 input 事件，onChange 才会收到
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'ada@example.com',
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('点「年付」：先同步开空白页，拿到收银台地址后把它导过去，并断开 opener', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, checkoutUrl: 'https://pancake.waffo.ai/c#token=t' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    mountForm()
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[value="premium-yearly"]')?.click(),
    )
    expect(window.open).toHaveBeenCalledWith('', '_blank')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      plan: 'premium-yearly',
      email: 'ada@example.com',
    })
    expect(tab.location.href).toBe('https://pancake.waffo.ai/c#token=t')
    expect(tab.opener).toBeNull()
    // 打开之后留一个链接：访客没看到新标签页时可以再开一次
    const link = host.querySelector('.checkout-status a')
    expect(link?.textContent).toBe(checkout.opened)
    expect(link?.getAttribute('href')).toBe('https://pancake.waffo.ai/c#token=t')
  })

  it('等待期间空白页被关掉时，退回一个让访客自己点的链接', async () => {
    const tab = { opener: {} as unknown, closed: true, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: true, checkoutUrl: 'https://pancake.waffo.ai/c' })),
    )
    mountForm()
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[value="premium-monthly"]')?.click(),
    )
    expect(tab.location.href).toBe('')
    expect(host.querySelector('.checkout-status a')?.textContent).toBe(checkout.openManually)
  })

  it('服务端拒绝时关掉空白页，显示对应的错误', async () => {
    const tab = { opener: null, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: false, error: 'rate_limited' }, { status: 429 })),
    )
    mountForm()
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[value="premium-monthly"]')?.click(),
    )
    expect(tab.close).toHaveBeenCalled()
    expect(host.querySelector('.checkout-status')?.textContent).toBe(checkout.errors.rateLimited)
    // 错误关联到输入框，读屏能在焦点处读到它
    const input = host.querySelector('input[type="email"]')
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    expect(input?.getAttribute('aria-describedby')).toBe(host.querySelector('.checkout-status')?.id)
    // 付款与试用说明不会被状态挤掉
    expect(host.querySelector('.pricing-fineprint')?.textContent).toBe(checkout.fineprint)
  })
})
