/**
 * 客户端安装包的下载与自动更新：都在 GitHub Releases 上，Worker 只做跳转。
 *
 * 客户端仓库的 Release 工作流（.github/workflows/release.yml）每次发布都标为 Latest。
 * 安装包带版本号（`umuo-v<版本>.dmg`），下载下来的文件名一看就知道是哪一版；
 * Sparkle 的 `appcast.xml` 名字固定，`releases/latest/download/appcast.xml` 永远指向最新版。
 * 官网不存任何安装包。
 */
const REPO = 'https://github.com/youming-ai/umuo'
export const GITHUB_LATEST = `${REPO}/releases/latest/download`

/** `/download/macos/<文件>` 里还在用的那一个：SUFeedURL 曾指向这里，留着让这样的安装继续收到更新 */
const APPCAST = 'appcast.xml'

/** 最新版本号缓存多久：发布后最迟这么久官网就跟上，又不至于每次下载都去问 GitHub */
const LATEST_TTL_MS = 5 * 60 * 1000

/** 只认 `vX.Y.Z` 形式的 tag，别的（草稿、手写 tag）一律当作查不到 */
const TAG = /\/releases\/tag\/(v\d+\.\d+\.\d+)$/

let cached: { tag: string; at: number } | undefined

/** 302 而不是 301：目标随每次发布变，不能让浏览器或缓存记住。`no-store` 同理。 */
function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } })
}

/**
 * 最新 Release 的 tag（如 `v0.2.5`）。`releases/latest` 会被 GitHub 302 到 `releases/tag/<tag>`，
 * 读这个跳转就知道版本号——不走 GitHub API，不受未认证 API 的每小时次数限制。查不到返回 undefined。
 */
export async function latestTag(
  fetcher: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<string | undefined> {
  if (cached && now - cached.at < LATEST_TTL_MS) return cached.tag
  try {
    const response = await fetcher(`${REPO}/releases/latest`, {
      method: 'HEAD',
      redirect: 'manual',
    })
    const tag = TAG.exec(response.headers.get('location') ?? '')?.[1]
    if (!tag) return cached?.tag
    cached = { tag, at: now }
    return tag
  } catch {
    // GitHub 暂时连不上时沿用上一次的结果（哪怕过期），总比让下载失败好
    return cached?.tag
  }
}

/** 测试用：清掉缓存的版本号 */
export function resetLatestTagCache(): void {
  cached = undefined
}

/**
 * `/download/macos`：最新版的安装包 `umuo-v<版本>.dmg`（Apple Silicon）。
 * 查不到版本号时退回最新 Release 的页面，让人自己点下载，而不是给一个 404。
 */
export async function handleMacosDownload(fetcher: typeof fetch = fetch): Promise<Response> {
  const tag = await latestTag(fetcher)
  return redirect(
    tag ? `${REPO}/releases/download/${tag}/umuo-${tag}.dmg` : `${REPO}/releases/latest`,
  )
}

/**
 * `/download/macos/<文件>`：只剩 `appcast.xml`（Sparkle 清单）一条，跳到最新 Release 的 appcast.xml；
 * 其余旧地址（update.json、latest.json、旧的安装包与更新包）都已下线，返回 null 交给 404。
 */
export function handleMacosUpdateFile(name: string): Response | null {
  return name === APPCAST ? redirect(`${GITHUB_LATEST}/${APPCAST}`) : null
}
