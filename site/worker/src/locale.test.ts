import { describe, expect, it } from 'vitest'
import { HTML_LANG as WEB_HTML_LANG, LOCALES as WEB_LOCALES } from '../../apps/web/src/config'
import { dispatch } from './dispatch'
import type { Env } from './env'
import { HTML_LANG, LOCALES, pickLocale } from './locale'

/** 假的静态资源：只有 /<locale>/ 返回写着语言名的 HTML，其余 404；记下被请求的路径 */
function fakeEnv(requested: string[] = []): Env {
  return {
    ASSETS: {
      async fetch(request) {
        const { pathname } = new URL(request.url)
        requested.push(pathname)
        const [locale, ...rest] = pathname.split('/').filter(Boolean)
        const known =
          pathname.endsWith('/') &&
          (LOCALES as readonly string[]).includes(locale ?? '') &&
          rest.length === 0
        if (!known) return new Response('not found', { status: 404 })
        return new Response(`<html data-locale="${locale}">`, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      },
    },
  }
}

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://umuo.app${path}`, { headers })

describe('按访客挑语言', () => {
  it('语言清单与 <html lang> 映射都与官网一致', () => {
    expect([...LOCALES]).toEqual([...WEB_LOCALES])
    expect(HTML_LANG).toEqual(WEB_HTML_LANG)
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
    const response = await dispatch(
      request('/', { 'accept-language': 'en-GB,en;q=0.9' }),
      fakeEnv(requested),
    )
    expect(response.status).toBe(200)
    expect(requested).toEqual(['/en/'])
    expect(await response.text()).toContain('data-locale="en"')
    expect(response.headers.get('vary')).toBe('Cookie, Accept-Language')
    expect(response.headers.get('content-language')).toBe('en')
  })

  it('带语言前缀的旧地址记住语言后 301 回 /，查询参数保留', async () => {
    for (const path of ['/ko/', '/ko', '/en/faq/']) {
      const response = await dispatch(request(path), fakeEnv())
      expect(response.status, path).toBe(301)
      expect(response.headers.get('location')).toBe('https://umuo.app/')
      expect(response.headers.get('set-cookie')).toContain(`umuo-lang=${path.split('/')[1]}`)
    }
    const tagged = await dispatch(request('/ja/?utm_source=x'), fakeEnv())
    expect(tagged.headers.get('location')).toBe('https://umuo.app/?utm_source=x')
  })

  it('已删除的 /terms、/privacy 旧地址返回 404；带语言前缀的照通用规则 301 回 /', async () => {
    for (const path of ['/terms', '/terms/', '/privacy', '/privacy/']) {
      const response = await dispatch(
        request(path, { cookie: 'umuo-lang=ja', accept: 'text/html' }),
        fakeEnv(),
      )
      expect(response.status, path).toBe(404)
      // 404 页按协商出的语言写 lang 与那句话
      const body = await response.text()
      expect(body, path).toContain('<html lang="ja">')
      expect(body, path).toContain('ページが見つかりません')
    }
    for (const path of ['/zh-cn/terms', '/en/privacy/']) {
      const response = await dispatch(request(path), fakeEnv())
      expect(response.status, path).toBe(301)
      expect(response.headers.get('location'), path).toBe('https://umuo.app/')
      expect(response.headers.get('set-cookie'), path).toContain(`umuo-lang=${path.split('/')[1]}`)
    }
  })

  it('/index.html 301 回 /，不留第二个首页地址', async () => {
    const response = await dispatch(request('/index.html?ref=a'), fakeEnv())
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://umuo.app/?ref=a')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('挑中的语言页取不到时退回简体中文，都取不到返回 503', async () => {
    const requested: string[] = []
    const missingEn: Env = {
      ...fakeEnv(requested),
      ASSETS: {
        async fetch(req) {
          const { pathname } = new URL(req.url)
          requested.push(pathname)
          return pathname === '/en/'
            ? new Response('not found', { status: 404 })
            : new Response('<html data-locale="zh-cn">')
        },
      },
    }
    const fallback = await dispatch(request('/', { 'accept-language': 'en' }), missingEn)
    expect(fallback.status).toBe(200)
    expect(requested).toEqual(['/en/', '/zh-cn/'])
    expect(fallback.headers.get('content-language')).toBe('zh-cn')

    const broken: Env = {
      ...fakeEnv(),
      ASSETS: {
        fetch: async () => {
          throw new Error('binding down')
        },
      },
    }
    expect((await dispatch(request('/'), broken)).status).toBe(503)
  })

  it('不是语言前缀的未知路径仍然 404，默认简体中文、不用蓝色链接', async () => {
    const response = await dispatch(request('/english/'), fakeEnv())
    expect(response.status).toBe(404)
    const body = await response.text()
    expect(body).toContain('<html lang="zh-Hans">')
    expect(body).toContain('页面不存在')
    expect(body).not.toMatch(/#(0b57d0|9ecbff)/i)
    const en = await dispatch(request('/english/', { 'accept-language': 'en' }), fakeEnv())
    expect(await en.text()).toContain('<html lang="en">')
  })

  it('首页只认 GET / HEAD，其余方法 405 并给出 Allow', async () => {
    const requested: string[] = []
    const response = await dispatch(
      new Request('https://umuo.app/', { method: 'POST', body: 'x' }),
      fakeEnv(requested),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
    expect(requested).toEqual([])
    const head = await dispatch(new Request('https://umuo.app/', { method: 'HEAD' }), fakeEnv())
    expect(head.status).toBe(200)
  })
})
