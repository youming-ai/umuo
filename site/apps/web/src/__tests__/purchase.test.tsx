// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 购买开关打开时（config.ts 的 `PURCHASE_OPEN = true`）：首页与定价页的下载区出现「购买 US$9」，
 * 点击后向 Worker 要收银台链接并跳过去。开关关闭（默认）的情形由 pages.test.tsx 覆盖。
 */
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  PURCHASE_OPEN: true,
}))

const { App } = await import('../App')

let root: Root
let host: HTMLDivElement
const assign = vi.fn()

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal('requestAnimationFrame', vi.fn())
  document.documentElement.dataset.locale = 'zh-cn'
  // biome-ignore lint/suspicious/noDocumentCookie: 清掉上一个用例留下的语言 cookie
  document.cookie = 'umuo-lang=; max-age=0; path=/'
  assign.mockReset()
  vi.spyOn(window.location, 'assign').mockImplementation(assign)
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  root = createRoot(host)
  act(() => root.render(<App />))
}

const buyButton = () =>
  [...host.querySelectorAll<HTMLButtonElement>('.download-desktop button')].find((button) =>
    button.textContent?.includes('购买 US$9'),
  )

describe('购买开关打开', () => {
  it('定价页：下载按钮旁出现购买按钮，上面换成试用说明，下面是激活说明', () => {
    renderAt('/pricing')
    const page = host.querySelector('.pricing-page')
    expect(buyButton()).toBeTruthy()
    expect(page?.textContent).not.toContain('正式购买尚未开放')
    expect(page?.querySelector('.pricing-free')?.textContent).toContain('免费试用 7 天')
    expect(page?.querySelector('.purchase-activation')?.textContent).toContain('3 台 Mac')
    // 不收邮箱：没有表单
    expect(host.querySelector('form')).toBeNull()
  })

  it('首页：只多一个购买按钮，激活说明留给定价页（首页只有一屏）', () => {
    renderAt('/')
    expect(buyButton()).toBeTruthy()
    expect(host.querySelector('.purchase-activation')).toBeNull()
  })

  it('点击后带上当前语言请求 /api/checkout，拿到链接就跳过去', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ url: 'https://pancake.waffo.ai/checkout#token=t' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/pricing')
    await act(async () => buyButton()?.click())
    expect(fetchMock).toHaveBeenCalledWith('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'zh-cn' }),
    })
    expect(assign).toHaveBeenCalledWith('https://pancake.waffo.ai/checkout#token=t')
  })

  it('Worker 回 503（收费还没配好）时不跳转，就地说明', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: false }, { status: 503 })),
    )
    renderAt('/pricing')
    await act(async () => buyButton()?.click())
    expect(assign).not.toHaveBeenCalled()
    expect(host.querySelector('.purchase-error')?.textContent).toContain('暂时不可用')
  })

  it('网络出错时给出重试提示，按钮恢复可点', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network')
      }),
    )
    renderAt('/pricing')
    await act(async () => buyButton()?.click())
    expect(host.querySelector('.purchase-error')?.textContent).toContain('稍后再试')
    expect(buyButton()?.disabled).toBe(false)
  })
})
