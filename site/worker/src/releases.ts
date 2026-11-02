/**
 * 客户端安装包的下载与自动更新：都在 GitHub Releases 上，Worker 只做跳转。
 *
 * 客户端仓库的 Release 工作流（.github/workflows/release.yml）每次发布都标为 Latest，附件名固定
 * （umuo.dmg / umuo.app.tar.gz / appcast.xml），所以 `releases/latest/download/<文件名>` 永远指向最新版。
 * 官网因此不存任何安装包，也不需要知道当前版本号。
 */
export const GITHUB_LATEST = 'https://github.com/youming-ai/umuo/releases/latest/download'

/** `/download/macos/<文件>` 里还在用的那一个：SUFeedURL 曾指向这里，留着让这样的安装继续收到更新 */
const APPCAST = 'appcast.xml'

/**
 * 302 而不是 301：目标随每次发布变（GitHub 再跳到具体版本的文件），不能让浏览器或缓存记住。
 * `no-store` 同理。
 */
function redirectTo(file: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location: `${GITHUB_LATEST}/${file}`, 'cache-control': 'no-store' },
  })
}

/** `/download/macos`：最新版的通用安装包（GitHub Release 的 umuo.dmg）。 */
export function handleMacosDownload(): Response {
  return redirectTo('umuo.dmg')
}

/**
 * `/download/macos/<文件>`：只剩 `appcast.xml`（Sparkle 清单）一条，跳到最新 Release 的 appcast.xml；
 * 其余旧地址（update.json、latest.json、带版本号的安装包与更新包）都已随 R2 下线，返回 null 交给 404。
 */
export function handleMacosUpdateFile(name: string): Response | null {
  return name === APPCAST ? redirectTo(APPCAST) : null
}
