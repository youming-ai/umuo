/// <reference types="node" />
import { describe, expect, it } from 'vitest'
// Void 运行时里真正包住应用的两层（与构建生成的 .void/entry.ts 一致）。void 锁在 1.2.1，路径稳定。
import {
  createAssetFallback,
  createWorkerFetch,
} from '../../node_modules/void/dist/runtime/routing.mjs'
import type { Env, ReleaseObject } from './env'
import worker from './index'
import { LATEST_KEY, UPDATE_KEY } from './releases'
import { legacyMiddleware } from './void-middleware'

/**
 * 迁到 Void 的前提：同一个请求，两种部署回的状态码、响应头、正文完全一样。
 *
 * - 「旧版」：Cloudflare 资源层 + 旧入口。`run_worker_first` 里的路径先进 Worker；
 *   其余 GET / HEAD 先问资源层，命中就直接回，没命中（或别的方法）才进 Worker。
 *   列表固定为迁移前已发布的路径，避免配置删除后丢失回归基线。
 * - 「Void」：所有请求先进 Worker（`run_worker_first: ["/**"]`），经 Void 的 createWorkerFetch →
 *   中间件 → createAssetFallback（参数照抄生成的入口：notFound none、不做 SPA 兜底）。
 */

// ---------- 假的静态资源层：按 Cloudflare 的 html_handling = auto-trailing-slash 回 ----------

// 官网只有首页；条款与隐私页已删除，产物里不再有 /<locale>/terms/ 与 /<locale>/privacy/
const HTML_PAGES = ['']
const LOCALES = ['zh-cn', 'zh-tw', 'en', 'ja', 'ko']
const FILES: Record<string, string> = {
  '/index.html': '<html data-locale="zh-cn">root',
  '/favicon.svg': '<svg/>',
  '/assets/index-Cwmi45Kp.js': 'console.log(1)',
  '/assets/index-Dnv3QVWi.css': 'body{}',
  '/fonts/open-sans.woff2': 'woff2',
}
for (const locale of LOCALES)
  for (const page of HTML_PAGES)
    FILES[`/${locale}/${page}index.html`] = `<html data-locale="${locale}">${page}`

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  svg: 'image/svg+xml',
  js: 'text/javascript',
  css: 'text/css',
  woff2: 'font/woff2',
}

function serveFile(path: string, method: string): Response {
  const ext = path.slice(path.lastIndexOf('.') + 1)
  return new Response(method === 'HEAD' ? null : FILES[path], {
    headers: {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=0, must-revalidate',
      etag: `"${path.length}"`,
    },
  })
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
      return serveFile(`${path}index.html`, request.method)
    if (!path.endsWith('/') && FILES[`${path}/index.html`]) return redirect(url, `${path}/`)
    if (FILES[path] && !path.endsWith('.html')) return serveFile(path, request.method)
    return new Response('Not Found', { status: 404 })
  },
}

// ---------- 假的 KV / R2 ----------

function store() {
  const data = new Map<string, string>()
  return {
    get: async (key: string) => data.get(key) ?? null,
    put: async (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

const manifest = {
  version: '0.2.0',
  key: 'macos/umuo-0.2.0-universal.dmg',
  size: 4,
  sha256: 'abc',
  commit: 'deadbeef',
  publishedAt: '2026-10-08T00:00:00Z',
}

function env(releases: Record<string, string>): Env {
  return {
    ASSETS: fakeAssets,
    NOTIFY_KV: store(),
    RELEASES: {
      async get(key): Promise<ReleaseObject | null> {
        const content = releases[key]
        if (content === undefined) return null
        return {
          body: new Response(content).body,
          size: new TextEncoder().encode(content).length,
          text: async () => content,
        }
      },
    },
  }
}

const WITH_RELEASE = {
  [LATEST_KEY]: JSON.stringify(manifest),
  [manifest.key]: 'DMG!',
  [UPDATE_KEY]: '{"version":"0.2.0"}',
  'macos/umuo-0.2.0-universal.app.tar.gz': 'TARGZ',
}

// ---------- 两种部署 ----------

const runWorkerFirst = [
  '/',
  '/index.html',
  '/pricing',
  '/pricing/',
  '/terms',
  '/terms/',
  '/privacy',
  '/privacy/',
  '/activate',
  '/activate/',
  '/zh-cn',
  '/zh-cn/*',
  '/zh-tw',
  '/zh-tw/*',
  '/en',
  '/en/*',
  '/ja',
  '/ja/*',
  '/ko',
  '/ko/*',
  '/api/*',
  '/download/*',
]

function workerFirst(pathname: string): boolean {
  return runWorkerFirst.some((pattern) =>
    pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern,
  )
}

async function today(request: Request, e: Env): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (!workerFirst(pathname) && (request.method === 'GET' || request.method === 'HEAD')) {
    const asset = await e.ASSETS.fetch(request)
    if (asset.status !== 404) return asset
  }
  return worker.fetch(request, e)
}

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
const callVoid = (request: Request, e: Env) =>
  viaVoid(request, e as unknown as Record<string, unknown>, {} as ExecutionContext)

async function snapshot(response: Response) {
  return {
    status: response.status,
    headers: [...response.headers].sort(([a], [b]) => a.localeCompare(b)),
    body: await response.text(),
  }
}

// ---------- 路径表 ----------

type Case = [label: string, path: string, init?: RequestInit, releases?: Record<string, string>]

const ja = { headers: { 'accept-language': 'ja,en;q=0.8' } }
const cookieKo = { headers: { cookie: 'umuo-lang=ko' } }
const html = { headers: { accept: 'text/html,application/xhtml+xml' } }
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
  body: JSON.stringify(body),
})

const CASES: Case[] = [
  ['首页（默认语言）', '/'],
  ['首页（Accept-Language）', '/', ja],
  ['首页（cookie）', '/', cookieKo],
  ['/index.html 301', '/index.html?ref=a'],
  // 已删除的「免费与开源」页，与 /activate 一样直接 404（旧快照里它在 run_worker_first 中）
  ['已删除的 /pricing', '/pricing', html],
  // 已删除的条款与隐私页，同样直接 404（旧快照里它们在 run_worker_first 中）
  ['已删除的 /terms', '/terms', html],
  ['已删除的 /privacy/', '/privacy/', html],
  ...LOCALES.map((locale): Case => [`语言前缀 /${locale}/`, `/${locale}/`]),
  ['语言前缀不带斜杠', '/en'],
  ['语言前缀 + 已删除的页面', '/ja/terms/?utm_source=x'],
  ['语言前缀内部文件', '/en/index.html'],
  ['语言前缀未知子路径', '/zh-tw/faq/'],
  ['/api/health', '/api/health'],
  ['/api/release（有版本）', '/api/release', undefined, WITH_RELEASE],
  ['/api/release（无版本）', '/api/release'],
  ['/api/notify POST', '/api/notify', post({ email: 'a@example.com' })],
  ['/api/notify GET', '/api/notify'],
  // umuo 改为免费开源后收费与许可证接口已删除，旧路径落到 /api 的 404
  ['已删除的 /api/checkout', '/api/checkout', post({ locale: 'en' })],
  ['已删除的 /api/waffo/webhook', '/api/waffo/webhook', post({})],
  ['已删除的 /api/license/verify', '/api/license/verify', post({ licenseKey: 'x' })],
  // 已删除的激活页：旧快照里它在 run_worker_first 中，现在回 404 页
  ['已删除的 /activate', '/activate', html],
  ['/api 未知路径', '/api/nope', html],
  ['/download/macos（有版本）', '/download/macos', undefined, WITH_RELEASE],
  ['/download/macos（无版本）', '/download/macos'],
  ['update.json 200', '/download/macos/update.json', undefined, WITH_RELEASE],
  ['update.json 204', '/download/macos/update.json'],
  ['Sparkle 空频道', '/download/macos/appcast.xml'],
  ['tar.gz 200', '/download/macos/umuo-0.2.0-universal.app.tar.gz', undefined, WITH_RELEASE],
  ['tar.gz 缺失 404', '/download/macos/umuo-9.9.9-universal.app.tar.gz', undefined, WITH_RELEASE],
  ['下载目录外的文件名 404', '/download/macos/latest.json', html, WITH_RELEASE],
  ['静态资源 js', '/assets/index-Cwmi45Kp.js'],
  ['静态资源 css', '/assets/index-Dnv3QVWi.css'],
  ['静态资源 HEAD', '/assets/index-Cwmi45Kp.js', { method: 'HEAD' }],
  ['静态资源 带条件请求', '/fonts/open-sans.woff2', { headers: { 'if-none-match': '"x"' } }],
  ['favicon', '/favicon.svg'],
  ['缺失的资源 404', '/assets/missing.js'],
  ['未知页面 404（浏览器）', '/no-such-page', html],
  ['未知目录 404', '/english/', html],
  ['资源路径 POST 404', '/favicon.svg', { method: 'POST' }],
]

describe('Void 中间件与现状逐字节一致', () => {
  it('旧版的 run_worker_first 快照包括下载路由', () => {
    expect(runWorkerFirst).toContain('/download/*')
    expect(runWorkerFirst.length).toBeGreaterThan(10)
  })

  it.each(CASES)('%s', async (_label, path, init, releases = {}) => {
    const url = `https://umuo.app${path}`
    const expected = await snapshot(await today(new Request(url, init), env(releases)))
    const actual = await snapshot(await callVoid(new Request(url, init), env(releases)))
    expect(actual).toEqual(expected)
  })

  it('几个关键结果本身也对（避免两边一起错）', async () => {
    const call = async (path: string, init?: RequestInit, releases = {}) =>
      callVoid(new Request(`https://umuo.app${path}`, init), env(releases))
    expect((await call('/download/macos/update.json')).status).toBe(204)
    expect((await call('/download/macos/update.json', undefined, WITH_RELEASE)).status).toBe(200)
    const tar = await call(
      '/download/macos/umuo-0.2.0-universal.app.tar.gz',
      undefined,
      WITH_RELEASE,
    )
    expect(tar.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    for (const path of ['/api/checkout', '/api/waffo/webhook', '/api/license/claim']) {
      const gone = await call(path, post({}))
      expect(gone.status).toBe(404)
      expect(await gone.json()).toEqual({ ok: false, error: 'not_found' })
    }
    expect((await call('/activate', html)).status).toBe(404)
    for (const path of ['/pricing', '/terms', '/terms/', '/privacy', '/privacy/'])
      expect((await call(path, html)).status, path).toBe(404)
    const missing = await call('/no-such-page', html)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('页面不存在')
    const page = await call('/', ja)
    expect(page.headers.get('content-language')).toBe('ja')
    expect(await page.text()).toContain('data-locale="ja"')
    expect((await call('/assets/index-Cwmi45Kp.js')).headers.get('cache-control')).toBe(
      'public, max-age=0, must-revalidate',
    )
  })

  it('/__void/* 交还给 Void', async () => {
    let passed = false
    const response = await legacyMiddleware(
      { req: { raw: new Request('https://umuo.app/__void/ready') }, env: env({}) },
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
      { ...env({}), VERSION_METADATA: { id: 'candidate-version' } } as unknown as Record<
        string,
        unknown
      >,
      {} as ExecutionContext,
    )
    expect(await response.json()).toEqual({ ready: true, versionId: 'candidate-version' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
