import type { Env } from './env'
import { json } from './http'

/**
 * 客户端安装包的下载。
 *
 * 私有仓库的 Release 工作流每次合进 main 都会把新的 .dmg 传到 R2（`umuo-releases` 桶），
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

/** `/download/macos`：最新版的 .dmg，文件名带版本号。 */
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
      'content-disposition': `attachment; filename="umuo-${latest.version}.dmg"`,
      // 地址不变、内容随版本变：不能让任何一层缓存住旧版
      'cache-control': 'no-store',
    },
  })
}

/** `/api/release`：最新版的元数据（版本、大小、校验和），给官网与以后的「检查更新」用。 */
export async function handleRelease(env: Env): Promise<Response> {
  const latest = await readLatest(env)
  if (!latest) return json({ ok: false, error: 'no_release' }, 404)
  return json({ ok: true, macos: latest })
}
