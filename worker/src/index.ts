import type { Env } from './env'
import { json } from './http'
import { handleHealth, handleNotify } from './notify'

/**
 * 静态资源层没命中时的兜底页。
 *
 * 为什么要自己写：`[assets]` 命中已有文件时不会进 Worker，**没命中时反而会进**。
 * 所以「未知路径」默认会走到这里 —— 如果在这里回 JSON，浏览器点到一个坏链接
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

/**
 * umuo.app 的 Worker。
 *
 * `/api/*` 由这里处理；其余路径命中静态资源时不进 Worker，没命中时才会到这里
 * （见上面的 NOT_FOUND_HTML）。
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/notify') return handleNotify(request, env)
    if (pathname === '/api/health') return handleHealth(env)
    if (pathname.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404)
    return new Response(NOT_FOUND_HTML, {
      status: 404,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // 404 页跟着部署走，没有缓存的价值；缓存住反而会让修好的链接继续 404
        'cache-control': 'no-store',
      },
    })
  },
} satisfies ExportedHandler<Env>
