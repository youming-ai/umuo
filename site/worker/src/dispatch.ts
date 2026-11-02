import type { Env } from './env'
import { json } from './http'
import { handlePage, localeRedirect, pageFromPath } from './locale'
import { handleHealth, handleNotify } from './notify'
import { handleMacosDownload, handleMacosUpdateFile, handleRelease } from './releases'

/**
 * 静态资源也没命中时的兜底页。
 *
 * 为什么要自己写：未知路径最终都会走到这里 —— 如果在这里回 JSON，浏览器点到一个坏链接
 * 就会看到一屏 `{"ok":false}`。官网是预渲染的多页站，没有 SPA 兜底，
 * 因此这一页就是全站唯一的 404。
 */
const NOT_FOUND_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>404 — umuo</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-content: center;
        gap: 1rem; padding: 2rem; text-align: center; background: #fff; color: #16181d;
        font: 1rem/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #1c1d21; color: #ecedef; }
        a { color: #9ecbff; }
      }
      p { margin: 0; }
      code { font-size: 0.9em; opacity: 0.7; }
      a { color: #0b57d0; }
    </style>
  </head>
  <body>
    <p><code>404</code></p>
    <p>页面不存在 · This page does not exist.</p>
    <p><a href="/">← umuo.app</a></p>
  </body>
</html>
`

function notFoundPage(): Response {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 404 页跟着部署走，没有缓存的价值；缓存住反而会让修好的链接继续 404
      'cache-control': 'no-store',
    },
  })
}

/**
 * 不归 Worker 管的路径：原样交给静态资源层，资源层的响应（状态码、响应头、
 * auto-trailing-slash 的 307 跳转）一字不改地返回；资源层也没有时才回上面的 404 页。
 *
 * 两种部署下这一步的意义不同，结果一致：
 * - wrangler：`run_worker_first` 之外的路径，资源层命中时根本不进 Worker，能走到这里的
 *   都是没命中的，再问一次资源层仍是 404，于是回 404 页 —— 与以前完全一样；
 * - Void：所有请求都先进 Worker（`run_worker_first: ["/**"]`），js / css / 字体都要靠这里
 *   去资源层取，取法与 Cloudflare 资源层直接回的一致。
 *
 * 资源层只认 GET / HEAD，其余方法直接 404。
 */
async function assetOrNotFound(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404) return asset
  }
  return notFoundPage()
}

/**
 * umuo.app 的全部路由。wrangler 的入口（`./index.ts`）与 Void 的中间件
 * （`middleware/01.legacy.ts`）都只是调它，两边的行为因此只有这一份。
 *
 * `/`、`/pricing`、`/terms`、`/privacy`（按语言挑预渲染页）、语言前缀的旧地址、
 * `/api/*` 与 `/download/*` 由这里处理；其余路径交给静态资源层（见 assetOrNotFound）。
 */
export async function dispatch(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/') return handlePage(request, env)
  const page = pageFromPath(pathname)
  if (page) return handlePage(request, env, page)
  const redirect = localeRedirect(pathname, request.url)
  if (redirect) return redirect
  if (pathname === '/api/notify') return handleNotify(request, env)
  if (pathname === '/api/health') return handleHealth(env)
  if (pathname === '/api/release') return handleRelease(env)
  if (pathname === '/download/macos') return handleMacosDownload(env)
  if (pathname.startsWith('/download/macos/'))
    return handleMacosUpdateFile(env, pathname.slice('/download/macos/'.length))
  if (pathname.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404)
  return assetOrNotFound(request, env)
}
