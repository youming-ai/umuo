import { describe, expect, it } from 'vitest'
import { LOCALES as WEB_LOCALES } from '../../apps/web/src/config'
import type { Env } from './env'
import worker from './index'
import { LOCALES, pickLocale } from './locale'

/** 假的静态资源：/<locale>/ 返回写着语言名的 HTML，记下被请求的路径 */
function fakeEnv(requested: string[] = []): Env {
  return {
    ASSETS: {
      async fetch(request) {
        const { pathname } = new URL(request.url)
        requested.push(pathname)
        return new Response(`<html data-locale="${pathname.slice(1, -1)}">`, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      },
    },
    NOTIFY_KV: { get: async () => null, put: async () => {} },
    RELEASES: { get: async () => null },
  }
}

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://umuo.app${path}`, { headers })

describe('按访客挑语言', () => {
  it('语言清单与官网一致', () => {
    expect([...LOCALES]).toEqual([...WEB_LOCALES])
  })

  it('cookie 优先，其次浏览器语言（按 q 值），最后简体中文', () => {
    expect(pickLocale(request('/', { cookie: 'a=1; umuo-lang=ja', 'accept-language': 'en' }))).toBe(
      'ja',
    )
    expect(pickLocale(request('/', { cookie: 'umuo-lang=xx', 'accept-language': 'ko-KR' }))).toBe(
      'ko',
    )
    expect(pickLocale(request('/', { 'accept-language': 'fr;q=1, en-US;q=0.8, ja;q=0.9' }))).toBe(
      'ja',
    )
    expect(pickLocale(request('/', { 'accept-language': 'zh-TW' }))).toBe('zh-tw')
    expect(pickLocale(request('/', { 'accept-language': 'zh-Hant-HK' }))).toBe('zh-tw')
    expect(pickLocale(request('/', { 'accept-language': 'zh-CN,zh;q=0.9' }))).toBe('zh-cn')
    expect(pickLocale(request('/', { 'accept-language': 'de, fr' }))).toBe('zh-cn')
    expect(pickLocale(request('/'))).toBe('zh-cn')
  })
})

describe('首页地址', () => {
  it('/ 返回挑中语言的预渲染页，缓存按 Cookie 与 Accept-Language 区分', async () => {
    const requested: string[] = []
    const response = await worker.fetch(
      request('/', { 'accept-language': 'en-GB,en;q=0.9' }),
      fakeEnv(requested),
    )
    expect(requested).toEqual(['/en/'])
    expect(await response.text()).toContain('data-locale="en"')
    expect(response.headers.get('vary')).toBe('Cookie, Accept-Language')
    expect(response.headers.get('content-language')).toBe('en')
  })

  it('带语言前缀的旧地址记住语言后 301 回 /', async () => {
    for (const path of ['/ko/', '/ko', '/en/pricing/']) {
      const response = await worker.fetch(request(path), fakeEnv())
      expect(response.status, path).toBe(301)
      expect(response.headers.get('location')).toBe('https://umuo.app/')
      expect(response.headers.get('set-cookie')).toContain(`umuo-lang=${path.split('/')[1]}`)
    }
  })

  it('不是语言前缀的未知路径仍然 404', async () => {
    const response = await worker.fetch(request('/english/'), fakeEnv())
    expect(response.status).toBe(404)
  })
})
