// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withViewTransition } from '../lib/transition'

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduced-motion'),
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'startViewTransition')
})

describe('withViewTransition', () => {
  it('浏览器不支持时同步执行，结果与原来一样', () => {
    stubReducedMotion(false)
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('支持时交给 startViewTransition，更新在回调里执行', () => {
    stubReducedMotion(false)
    const update = vi.fn()
    const start = vi.fn((callback: () => void) => callback())
    Reflect.set(document, 'startViewTransition', start)
    withViewTransition(update)
    expect(start).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('访客要求减少动态效果时跳过过渡，直接更新', () => {
    stubReducedMotion(true)
    const update = vi.fn()
    const start = vi.fn()
    Reflect.set(document, 'startViewTransition', start)
    withViewTransition(update)
    expect(start).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })
})
