import type { Env } from './env'
import { json } from './http'

/**
 * 客户端安装包的下载。
 *
 * 本机发布脚本显式 --publish 时把新的 .dmg 传到 R2（`umuo-releases` 桶），
 * 最后写 `macos/latest.json` 指向它。这里只认 latest.json：安装包没传完之前它还指着上一版，
 * 访客不会下到半个文件。
 */
export const LATEST_KEY = 'macos/latest.json'

export interface ReleaseManifest {
  version: string
  key: string
  size: number
  sha256: string
  commit: string
  publishedAt: string
}

/**
 * latest.json 读不出来、读取出错、或缺字段时返回 null —— 宁可说「还没有」，
 * 也不把人引到一个坏链接，或让 /api/release 返回一份残缺的元数据。
 */
export async function readLatest(env: Env): Promise<ReleaseManifest | null> {
  try {
    const object = await env.RELEASES.get(LATEST_KEY)
    if (!object) return null
    const parsed = JSON.parse(await object.text()) as Partial<ReleaseManifest>
    const complete =
      typeof parsed.version === 'string' &&
      typeof parsed.key === 'string' &&
      typeof parsed.size === 'number' &&
      typeof parsed.sha256 === 'string' &&
      typeof parsed.commit === 'string' &&
      typeof parsed.publishedAt === 'string'
    return complete ? (parsed as ReleaseManifest) : null
  } catch {
    return null
  }
}

const NOT_READY_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>umuo</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; min-height: 100vh; display: grid; place-content: center; gap: 1rem;
        padding: 2rem; text-align: center;
        font: 1rem/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif; }
      p { margin: 0; }
    </style>
  </head>
  <body>
    <p>安装包正在准备中，请稍后再试。</p>
    <p>The download isn’t ready yet. Please try again shortly.</p>
    <p><a href="/">← umuo.app</a></p>
  </body>
</html>
`

function notReady(): Response {
  return new Response(NOT_READY_HTML, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * `/download/macos`：最新版的 .dmg。下载文件名就是发布流程上传的那个文件名
 * （R2 key 的最后一段，如 `umuo-0.1.2-universal.dmg`），和构建产物同名。
 */
export async function handleMacosDownload(env: Env): Promise<Response> {
  const latest = await readLatest(env)
  if (!latest) return notReady()
  // R2 瞬时故障时同样落到「正在准备中」，而不是一个 500
  const object = await env.RELEASES.get(latest.key).catch(() => null)
  if (!object) return notReady()
  return new Response(object.body, {
    headers: {
      'content-type': 'application/x-apple-diskimage',
      'content-length': String(object.size),
      'content-disposition': `attachment; filename="${downloadName(latest)}"`,
      // 地址不变、内容随版本变：不能让任何一层缓存住旧版
      'cache-control': 'no-store',
    },
  })
}

/**
 * 取 R2 key 的最后一段当文件名。清单里的字符串原样进响应头，所以只放行 `[\w.-]`：
 * key 不合规退回 `umuo-<版本>.dmg`，版本号也不合规就用 `umuo.dmg`。
 */
export function downloadName(latest: ReleaseManifest): string {
  const safe = /^[\w.-]+$/
  const name = latest.key.split('/').pop() ?? ''
  if (safe.test(name) && name.endsWith('.dmg')) return name
  return safe.test(latest.version) ? `umuo-${latest.version}.dmg` : 'umuo.dmg'
}

/** `/api/release`：最新版的元数据（版本、大小、校验和），给官网与以后的「检查更新」用。 */
export async function handleRelease(env: Env): Promise<Response> {
  const latest = await readLatest(env)
  if (!latest) return json({ ok: false, error: 'no_release' }, 404)
  return json({ ok: true, macos: latest })
}

/** 客户端自动更新（tauri-plugin-updater）的清单，由 Release 工作流在更新包传完后写入。 */
export const UPDATE_KEY = 'macos/update.json'

/** 只放行两种更新清单与更新包：这条路由按地址读 R2，不能变成整个桶的浏览入口。 */
const UPDATE_PACKAGE = /^umuo-\d+\.\d+\.\d+-universal\.app\.tar\.gz$/

/**
 * `/download/macos/<文件>`：旧版 Tauri 与原生 Sparkle 各读自己的清单，共用版本更新包。
 *
 * - `appcast.xml`：Sparkle RSS，未发布时返回空频道；
 *
 * - `update.json`：还没发过带更新包的版本时回 204 —— 更新插件把 204 当作「没有新版」，
 *   而不是报错；
 * - `umuo-<版本>-universal.app.tar.gz`：带版本号，内容永远不变，可以长缓存。
 *
 * 包的完整性不靠这里：客户端用各自内置公钥验 minisign / EdDSA 签名，Worker 或 R2 被换包也装不上。
 */
export async function handleMacosUpdateFile(env: Env, name: string): Promise<Response> {
  if (name === 'appcast.xml') {
    try {
      const object = await env.RELEASES.get('macos/appcast.xml')
      return new Response(
        object?.body ??
          '<?xml version="1.0"?><rss version="2.0"><channel><title>umuo</title><link>https://umuo.app</link><description>umuo macOS updates</description></channel></rss>',
        {
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'no-store',
          },
        },
      )
    } catch {
      return json({ ok: false, error: 'release_unavailable' }, 503)
    }
  }
  if (name === 'update.json') {
    const object = await env.RELEASES.get(UPDATE_KEY).catch(() => null)
    if (!object)
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    return new Response(object.body, {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }
  if (!UPDATE_PACKAGE.test(name)) return json({ ok: false, error: 'not_found' }, 404)
  const object = await env.RELEASES.get(`macos/${name}`).catch(() => null)
  if (!object) return json({ ok: false, error: 'not_found' }, 404)
  return new Response(object.body, {
    headers: {
      'content-type': 'application/gzip',
      'content-length': String(object.size),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
