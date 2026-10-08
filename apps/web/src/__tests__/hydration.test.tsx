// @vitest-environment happy-dom

import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../App'
import { LOCALES } from '../config'
import { setInitialRouteForSsr } from '../lib/router'

/**
 * 预渲染产物必须能被 hydrate。
 *
 * 这条测试守的是一个**构建成功但线上出错**的失败形态：预渲染出来的 HTML 与客户端
 * 首次渲染只要有任意一处不同（主题图标、随机 id、读 window 的初始状态……），
 * React 就会在控制台报 hydration 错误，并把整棵树丢掉重渲染——预渲染的意义归零，
 * 而构建日志里一个警告都没有。
 *
 * 用未压缩的 React 跑，是为了让失败时给出**具体哪个元素**不匹配，
 * 而不是线上那条 `Minified React error #418`。
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // happy-dom 不带 matchMedia；主题初始化会用到它
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    })
  }
  window.localStorage.clear()
  document.documentElement.dataset.theme = 'dark'
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('预渲染的页面可以被 hydrate', () => {
  for (const locale of LOCALES) {
    it(`${locale}：hydrate 不产生任何 React 报错`, async () => {
      // 1) 服务端渲染（与构建期预渲染走的是同一条路径）
      setInitialRouteForSsr({ locale, hash: '' })
      const serverHtml = renderToString(<App />)
      expect(serverHtml.length).toBeGreaterThan(1000)

      // 2) 客户端在同样的 DOM 上 hydrate
      const container = document.createElement('div')
      container.innerHTML = serverHtml
      document.body.append(container)

      const errors: unknown[][] = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args)
      })

      try {
        await act(async () => {
          hydrateRoot(container, <App />)
        })
      } finally {
        spy.mockRestore()
      }

      expect(errors).toEqual([])
    })
  }

  it('主题不同也不会让 hydrate 报错（构建期不知道访客偏好）', async () => {
    // 预渲染时用暗色，访客偏好浅色——这是最常见的真实情形，必须不报错。
    setInitialRouteForSsr({ locale: 'zh-cn', hash: '' })
    const serverHtml = renderToString(<App />)

    document.documentElement.dataset.theme = 'light'
    const container = document.createElement('div')
    container.innerHTML = serverHtml
    document.body.append(container)

    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })

    try {
      await act(async () => {
        hydrateRoot(container, <App />)
      })
    } finally {
      spy.mockRestore()
    }

    expect(errors).toEqual([])
  })
})
