// @vitest-environment happy-dom

import { act } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { LOCALES } from '../config'
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
        // 首页只有一屏：main 里只有首屏
        expect(container.querySelectorAll('main > section')).toHaveLength(1)
        expect(container.querySelector('#download')).not.toBeNull()
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
