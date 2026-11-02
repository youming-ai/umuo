import type { Env } from './env'
import { json } from './http'
import { HTML_LANG, handlePage, type Locale, localeRedirect, pickLocale } from './locale'
import { handleMacosDownload, handleMacosUpdateFile } from './releases'

/**
 * 每个响应都带的安全头。官网不需要被别的站点嵌进 iframe，也用不到摄像头、麦克风这类能力。
 *
 * 只给 `frame-ancestors`，不做完整 CSP：页面有一段内联的主题脚本（要靠 hash 放行），
 * 演示组件又大量用 `style` 属性传 CSS 变量（要 `'unsafe-inline'`），完整策略稍有遗漏就会白屏，
 * 而本地测试证明不了线上（Cloudflare 可能往页面里注入脚本）。
 */
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  // 复制网址用到的剪贴板写入不在这里，照常可用
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
}

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value)
  return secured
}

/** 404 页的一句话，按协商出的语言给一种；页面 `lang` 随之写对 */
const NOT_FOUND_TEXT: Record<Locale, string> = {
  'zh-cn': '页面不存在。',
  'zh-tw': '頁面不存在。',
  en: 'This page does not exist.',
  ja: 'ページが見つかりません。',
  ko: '페이지를 찾을 수 없습니다.',
}

/**
 * 静态资源也没命中时的兜底页。
 *
 * 为什么要自己写：未知路径最终都会走到这里 —— 如果在这里回 JSON，浏览器点到一个坏链接
 * 就会看到一屏 `{"ok":false}`。官网是预渲染的单页站，没有 SPA 兜底，
 * 因此这一页就是全站唯一的 404。配色取官网的暖纸咖啡墨，界面不用蓝。
 */
function notFoundHtml(locale: Locale): string {
  return `<!doctype html>
<html lang="${HTML_LANG[locale]}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>404 — umuo</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0; min-height: 100vh; min-height: 100svh; display: grid; place-content: center;
        gap: 1rem; padding: 2rem; text-align: center; background: #fcf9f5; color: #2a1f1a;
        font: 1rem/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif;
      }
      p { margin: 0; }
      code { font-size: 0.9em; color: #7d6252; }
      a { color: #7e5236; text-underline-offset: 0.2em; }
      @media (prefers-color-scheme: dark) {
        body { background: #181310; color: #f4e6d2; }
        code { color: #a08a79; }
        a { color: #e0b48f; }
      }
    </style>
  </head>
  <body>
    <p><code>404</code></p>
    <p>${NOT_FOUND_TEXT[locale]}</p>
    <p><a href="/">← umuo.app</a></p>
  </body>
</html>
`
}

function notFoundPage(request: Request): Response {
  return new Response(notFoundHtml(pickLocale(request)), {
    status: 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 404 页跟着部署走，没有缓存的价值；缓存住反而会让修好的链接继续 404
      'cache-control': 'no-store',
    },
  })
}

/** Vite 产出的 `/assets/*` 文件名带内容哈希，内容一变地址就变，可以放心长期缓存 */
const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * 不归 Worker 管的路径：交给静态资源层取，资源层的响应（状态码、auto-trailing-slash 的 307 跳转）原样返回；
 * 资源层也没有时才回上面的 404 页。Void 部署下所有请求都先进 Worker（`run_worker_first: ["/**"]`），
 * js / css / 字体都靠这里去资源层取。
 *
 * 资源层给所有文件的都是 `max-age=0, must-revalidate`；带哈希的 `/assets/*` 在这里改成长期缓存，
 * 字体与 favicon 地址不带哈希，保持每次回源确认。
 *
 * 资源层只认 GET / HEAD，其余方法直接 404。
 */
async function assetOrNotFound(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404) {
      if (!pathname.startsWith('/assets/') || !(asset.ok || asset.status === 304)) return asset
      const cached = new Response(asset.body, asset)
      cached.headers.set('cache-control', IMMUTABLE)
      return cached
    }
  }
  return notFoundPage(request)
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/') return handlePage(request, env)
  const redirect = localeRedirect(pathname, request.url)
  if (redirect) return redirect
  // 部署后不要账号就能用的探针：`curl -s https://umuo.app/api/health`
  if (pathname === '/api/health') return json({ ok: true, service: 'umuo' })
  if (pathname === '/download/macos') return handleMacosDownload()
  if (pathname.startsWith('/download/macos/'))
    return handleMacosUpdateFile(pathname.slice('/download/macos/'.length)) ?? notFoundPage(request)
  if (pathname.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404)
  return assetOrNotFound(request, env, pathname)
}

/**
 * umuo.app 的全部路由，Void 的中间件（`middleware/01.legacy.ts`）只是调它。
 *
 * `/`（按语言挑预渲染页）、语言前缀的旧地址、
 * `/api/*` 与 `/download/*` 由这里处理；其余路径交给静态资源层（见 assetOrNotFound）。
 * 下载只做跳转（安装包在 GitHub Releases，见 releases.ts），`/download/macos/` 下认不出的旧地址回 404 页。
 * 所有响应最后统一补上安全头。
 */
export async function dispatch(request: Request, env: Env): Promise<Response> {
  return withSecurityHeaders(await route(request, env))
}
