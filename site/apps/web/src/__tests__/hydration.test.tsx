// @vitest-environment happy-dom

import { act } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { LEGAL_EFFECTIVE, LOCALES } from '../config'
import { render } from '../entry-server'
import { pagePath, SITE_PAGES } from '../lib/pages'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const roots: Root[] = []

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  window.localStorage.clear()
  document.documentElement.dataset.theme = 'dark'
})

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('五种语言的预渲染均可 hydrate', () => {
  for (const locale of LOCALES) {
    for (const page of SITE_PAGES) {
      it(`${locale}/${page}：真实 SSR 与客户端结构一致`, async () => {
        window.history.replaceState(null, '', pagePath(locale, page))
        // 线上由 Worker 返回的预渲染页在 <html> 上带着 data-locale
        document.documentElement.dataset.locale = locale
        const browserWindow = window
        let html: string
        // 用实际构建入口，并移除 window，确保测试走真正的 SSR 路由分支。
        vi.stubGlobal('window', undefined)
        try {
          html = render(locale, page)
        } finally {
          vi.stubGlobal('window', browserWindow)
        }
        const container = document.createElement('div')
        container.innerHTML = html
        document.body.append(container)
        expect(container.querySelectorAll('h1')).toHaveLength(1)
        if (page === 'home') {
          // 首页只有一屏：main 里只有首屏
          expect(container.querySelectorAll('main > section')).toHaveLength(1)
          expect(container.querySelector('#download')).not.toBeNull()
        } else if (page === 'pricing') {
          // 买断价格未定：不能再出现旧订阅价格
          expect(container.querySelector('main')?.textContent).not.toContain('$2.99')
          expect(container.querySelectorAll('.pricing-page')).toHaveLength(2)
        } else if (page === 'activate') {
          // 预渲染时还不知道领取码，只能是「正在确认」；密钥一定是客户端拿到后才出现
          expect(container.querySelector('main code')).toBeNull()
        } else {
          // 条款与隐私政策：支付处理方定案前不写名字；页面上带着生效日期
          expect(container.querySelector('main article')?.textContent).not.toContain('Waffo')
          expect(container.querySelector('main article')?.textContent).toContain(LEGAL_EFFECTIVE)
        }
        // 服务端未知访客主题，客户端主题不同也不得重建 DOM。
        document.documentElement.dataset.theme = 'light'
        const errors: unknown[][] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))
        try {
          await act(async () => {
            roots.push(hydrateRoot(container, <App />))
          })
        } finally {
          spy.mockRestore()
        }
        expect(errors).toEqual([])
        expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain(
          pagePath(locale, page),
        )
      })
    }
  }
})
