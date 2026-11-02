/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { legacyMiddleware } from '../../middleware/01.legacy'
// Void 运行时里真正包住应用的两层（与构建生成的 .void/entry.ts 一致）。void 锁在 1.2.1，路径稳定。
import {
  createAssetFallback,
  createWorkerFetch,
} from '../../node_modules/void/dist/runtime/routing.mjs'
import type { Env } from './env'

/**
 * 经 Void 运行时（createWorkerFetch → 中间件 → createAssetFallback，参数照抄生成的入口：
 * notFound none、不做 SPA 兜底）走一遍完整请求，断言线上实际会回的状态码、响应头与正文。
 * Void 部署下所有请求都先进 Worker（`run_worker_first: ["/**"]`）。
 */

// ---------- 假的静态资源层：按 Cloudflare 的 html_handling = auto-trailing-slash 回 ----------

const LOCALES = ['zh-cn', 'zh-tw', 'en', 'ja', 'ko']
const FILES: Record<string, string> = {
  '/index.html': '<html data-locale="zh-cn">root',
  '/favicon.svg': '<svg/>',
  '/assets/index-Cwmi45Kp.js': 'console.log(1)',
  '/assets/index-Dnv3QVWi.css': 'body{}',
  '/fonts/open-sans.woff2': 'woff2',
}
// 官网只有首页；条款与隐私页已删除，产物里只有 /<locale>/index.html
for (const locale of LOCALES) FILES[`/${locale}/index.html`] = `<html data-locale="${locale}">`

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  svg: 'image/svg+xml',
  js: 'text/javascript',
  css: 'text/css',
  woff2: 'font/woff2',
}

/** 资源层给每个文件的缓存头（Cloudflare 的默认值） */
const REVALIDATE = 'public, max-age=0, must-revalidate'

function serveFile(path: string, request: Request): Response {
  const ext = path.slice(path.lastIndexOf('.') + 1)
  const etag = `"${path.length}"`
  const headers = {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': REVALIDATE,
    etag,
  }
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers })
  return new Response(request.method === 'HEAD' ? null : FILES[path], { headers })
}

function redirect(url: URL, pathname: string): Response {
  const target = new URL(url)
  target.pathname = pathname
  return new Response(null, { status: 307, headers: { location: target.pathname + target.search } })
}

/** 只实现本站会碰到的 auto-trailing-slash 规则：目录用 `/x/` 取 `x/index.html`，其余写法 307 过去 */
const fakeAssets = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response(null, { status: 405 })
    if (path.endsWith('/index.html') && FILES[path]) return redirect(url, path.slice(0, -10))
    if (path.endsWith('/') && FILES[`${path}index.html`])
      return serveFile(`${path}index.html`, request)
    if (!path.endsWith('/') && FILES[`${path}/index.html`]) return redirect(url, `${path}/`)
    if (FILES[path] && !path.endsWith('.html')) return serveFile(path, request)
    return new Response('Not Found', { status: 404 })
  },
}

// 绑定只剩静态资源（上线通知的 KV 与安装包的 R2 都已下线）
const env = (): Env => ({ ASSETS: fakeAssets })

const viaVoid = createWorkerFetch({
  app: {
    async fetch(request, e) {
      // Hono：中间件没给响应（调了 next）且没有路由时回 404 文本
      const response = await legacyMiddleware(
        { req: { raw: request }, env: e as unknown as Env },
        async () => {},
      )
      return response ?? new Response('404 Not Found', { status: 404 })
    },
  },
  assets: createAssetFallback({ assetsDir: 'assets', serveSpaFallback: false, notFound: 'none' }),
  withRawEnv: (_e, fn) => fn(),
  withRuntimeEnv: (_e, fn) => fn(),
  filterBindings: (e) => e,
  internalRoute: async () => null,
  collectPrerenderPaths: async () => [],
  versionMetadataBinding: 'VERSION_METADATA',
})

/** 经 Void 运行时处理一个请求 */
const call = (path: string, init?: RequestInit) =>
  viaVoid(
    new Request(`https://umuo.app${path}`, init),
    env() as unknown as Record<string, unknown>,
    {} as ExecutionContext,
  )

// ---------- 路径表：每条写明线上应当回什么 ----------

const ja = { headers: { 'accept-language': 'ja,en;q=0.8' } }
const cookieKo = { headers: { cookie: 'umuo-lang=ko' } }
const html = { headers: { accept: 'text/html,application/xhtml+xml' } }
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
  body: JSON.stringify(body),
})

const RELEASES = 'https://github.com/youming-ai/umuo/releases/latest/download'

type Expected = {
  status: number
  location?: string
  cache?: string
  body?: string
  json?: unknown
}
type Case = [label: string, path: string, init: RequestInit | undefined, expected: Expected]

const page = (locale: string): Expected => ({
  status: 200,
  cache: 'no-cache',
  body: `data-locale="${locale}"`,
})
const notFound: Expected = { status: 404, cache: 'no-store', body: '<code>404</code>' }
const apiNotFound: Expected = {
  status: 404,
  cache: 'no-store',
  json: { ok: false, error: 'not_found' },
}
const home = (search = ''): Expected => ({
  status: 301,
  location: `https://umuo.app/${search}`,
  cache: 'no-store',
})

const CASES: Case[] = [
  ['首页（默认语言）', '/', undefined, page('zh-cn')],
  ['首页（Accept-Language）', '/', ja, page('ja')],
  ['首页（cookie）', '/', cookieKo, page('ko')],
  ['首页 POST 405', '/', post({}), { status: 405, cache: 'no-store' }],
  ['/index.html 301', '/index.html?ref=a', undefined, home('?ref=a')],
  // 已删除的「免费与开源」、条款、隐私与激活页：直接 404
  ['已删除的 /pricing', '/pricing', html, notFound],
  ['已删除的 /terms', '/terms', html, notFound],
  ['已删除的 /privacy/', '/privacy/', html, notFound],
  ['已删除的 /activate', '/activate', html, notFound],
  ...LOCALES.map((locale): Case => [`语言前缀 /${locale}/`, `/${locale}/`, undefined, home()]),
  ['语言前缀不带斜杠', '/en', undefined, home()],
  ['语言前缀 + 已删除的页面', '/ja/terms/?utm_source=x', undefined, home('?utm_source=x')],
  ['语言前缀内部文件', '/en/index.html', undefined, home()],
  ['语言前缀未知子路径', '/zh-tw/faq/', undefined, home()],
  [
    '/api/health',
    '/api/health',
    undefined,
    { status: 200, cache: 'no-store', json: { ok: true, service: 'umuo' } },
  ],
  // 安装包改走 GitHub Releases、上线通知与收费接口下线后，这些旧路径都落到 /api 的 404
  ['已删除的 /api/release', '/api/release', undefined, apiNotFound],
  ['已删除的 /api/notify POST', '/api/notify', post({ email: 'a@example.com' }), apiNotFound],
  ['已删除的 /api/checkout', '/api/checkout', post({ locale: 'en' }), apiNotFound],
  ['已删除的 /api/waffo/webhook', '/api/waffo/webhook', post({}), apiNotFound],
  ['已删除的 /api/license/verify', '/api/license/verify', post({ licenseKey: 'x' }), apiNotFound],
  ['/api 未知路径', '/api/nope', html, apiNotFound],
  [
    '/download/macos 跳到 GitHub',
    '/download/macos',
    undefined,
    { status: 302, location: `${RELEASES}/umuo.dmg`, cache: 'no-store' },
  ],
  [
    'appcast.xml 跳到 GitHub',
    '/download/macos/appcast.xml',
    undefined,
    { status: 302, location: `${RELEASES}/appcast.xml`, cache: 'no-store' },
  ],
  // R2 下线后的旧下载地址
  ['已删除的 update.json', '/download/macos/update.json', html, notFound],
  ['已删除的版本化更新包', '/download/macos/umuo-0.2.0-universal.app.tar.gz', html, notFound],
  // 带哈希的 /assets/* 长期缓存；字体与 favicon 地址不带哈希，保持每次回源确认
  [
    '静态资源 js',
    '/assets/index-Cwmi45Kp.js',
    undefined,
    { status: 200, cache: 'public, max-age=31536000, immutable', body: 'console.log(1)' },
  ],
  [
    '静态资源 css',
    '/assets/index-Dnv3QVWi.css',
    undefined,
    { status: 200, cache: 'public, max-age=31536000, immutable', body: 'body{}' },
  ],
  [
    '静态资源 HEAD',
    '/assets/index-Cwmi45Kp.js',
    { method: 'HEAD' },
    { status: 200, cache: 'public, max-age=31536000, immutable', body: '' },
  ],
  [
    '静态资源 304',
    '/assets/index-Dnv3QVWi.css',
    { headers: { 'if-none-match': '"26"' } },
    { status: 304, cache: 'public, max-age=31536000, immutable' },
  ],
  ['字体', '/fonts/open-sans.woff2', undefined, { status: 200, cache: REVALIDATE, body: 'woff2' }],
  ['favicon', '/favicon.svg', undefined, { status: 200, cache: REVALIDATE, body: '<svg/>' }],
  ['缺失的资源 404', '/assets/missing.js', undefined, notFound],
  ['未知页面 404（浏览器）', '/no-such-page', html, notFound],
  ['未知目录 404', '/english/', html, notFound],
  ['资源路径 POST 404', '/favicon.svg', { method: 'POST' }, notFound],
]

describe('经 Void 运行时的路由', () => {
  it.each(CASES)('%s', async (_label, path, init, expected) => {
    const response = await call(path, init)
    expect(response.status).toBe(expected.status)
    expect(response.headers.get('location')).toBe(expected.location ?? null)
    if (expected.cache) expect(response.headers.get('cache-control')).toBe(expected.cache)
    // 页面、接口、跳转、404 与静态资源都带安全头
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
    if (expected.json !== undefined) expect(await response.json()).toEqual(expected.json)
    else if (expected.body !== undefined) {
      const body = await response.text()
      if (expected.body === '') expect(body).toBe('')
      else expect(body).toContain(expected.body)
    }
  })

  it('首页按语言返回时缓存按 Cookie 与 Accept-Language 区分', async () => {
    const response = await call('/', ja)
    expect(response.headers.get('content-language')).toBe('ja')
    expect(response.headers.get('vary')).toBe('Cookie, Accept-Language')
  })

  it('/__void/* 交还给 Void', async () => {
    let passed = false
    const response = await legacyMiddleware(
      { req: { raw: new Request('https://umuo.app/__void/ready') }, env: env() },
      async () => {
        passed = true
      },
    )
    expect(response).toBeUndefined()
    expect(passed).toBe(true)
  })

  it('就绪检查返回候选版本的元数据', async () => {
    const response = await viaVoid(
      new Request('https://umuo.app/__void/ready'),
      { ...env(), VERSION_METADATA: { id: 'candidate-version' } } as unknown as Record<
        string,
        unknown
      >,
      {} as ExecutionContext,
    )
    expect(await response.json()).toEqual({ ready: true, versionId: 'candidate-version' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
