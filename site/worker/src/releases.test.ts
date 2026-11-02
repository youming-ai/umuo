import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatch } from './dispatch'
import type { Env } from './env'
import { latestTag, resetLatestTagCache } from './releases'

/** 下载只做跳转，不读任何绑定；静态资源层一律 404，确认旧地址落到 Worker 自己的 404 页。 */
const env: Env = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
}

const call = (path: string, init?: RequestInit) =>
  dispatch(new Request(`https://umuo.app${path}`, init), env)

const LATEST = 'https://github.com/youming-ai/umuo/releases/latest'
const DMG = 'https://github.com/youming-ai/umuo/releases/download/v0.2.5/umuo-v0.2.5.dmg'

/** GitHub 把 releases/latest 302 到 releases/tag/<tag> 的替身；记下被问了几次 */
function githubSays(location: string | null) {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 302, headers: location ? { location } : {} }),
  )
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

beforeEach(() => {
  resetLatestTagCache()
  vi.unstubAllGlobals()
})

describe('安装包下载', () => {
  it('/download/macos 302 到最新 Release 带版本号的 umuo-v<版本>.dmg，不缓存', async () => {
    const fetcher = githubSays(`${LATEST.replace('/latest', '')}/tag/v0.2.5`)
    const response = await call('/download/macos')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(DMG)
    expect(response.headers.get('cache-control')).toBe('no-store')
    // 只读跳转、不跟过去，也不走 GitHub API
    expect(fetcher).toHaveBeenCalledWith(LATEST, { method: 'HEAD', redirect: 'manual' })
  })

  it('HEAD 同样跳转', async () => {
    githubSays('https://github.com/youming-ai/umuo/releases/tag/v0.2.5')
    const response = await call('/download/macos', { method: 'HEAD' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(DMG)
  })

  it('版本号缓存 5 分钟，期间不再问 GitHub', async () => {
    const fetcher = githubSays('https://github.com/youming-ai/umuo/releases/tag/v0.2.5')
    const t0 = 1_000_000
    expect(await latestTag(fetch, t0)).toBe('v0.2.5')
    expect(await latestTag(fetch, t0 + 4 * 60 * 1000)).toBe('v0.2.5')
    expect(fetcher).toHaveBeenCalledTimes(1)
    githubSays('https://github.com/youming-ai/umuo/releases/tag/v0.2.6')
    expect(await latestTag(fetch, t0 + 6 * 60 * 1000)).toBe('v0.2.6')
  })

  it('查不到版本号时退回最新 Release 的页面，而不是 404', async () => {
    githubSays(null)
    const response = await call('/download/macos')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(LATEST)
  })

  it('GitHub 连不上时沿用上一次的版本号', async () => {
    githubSays('https://github.com/youming-ai/umuo/releases/tag/v0.2.5')
    expect(await latestTag(fetch, 0)).toBe('v0.2.5')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    )
    expect(await latestTag(fetch, 10 * 60 * 1000)).toBe('v0.2.5')
  })

  it('不认非 vX.Y.Z 的 tag', async () => {
    githubSays('https://github.com/youming-ai/umuo/releases/tag/nightly')
    expect(await latestTag(fetch, 0)).toBeUndefined()
  })
})

describe('自动更新', () => {
  it('旧的 Sparkle 清单地址 302 到 GitHub 最新 Release 的 appcast.xml', async () => {
    const response = await call('/download/macos/appcast.xml')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://github.com/youming-ai/umuo/releases/latest/download/appcast.xml',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('随 R2 下线的旧地址一律 404', async () => {
    for (const path of [
      '/download/macos/update.json',
      '/download/macos/latest.json',
      '/download/macos/umuo-0.1.9-universal.app.tar.gz',
      '/download/macos/umuo-0.1.7-universal.dmg',
      '/download/macos/',
      '/download/macos/appcast.xml/x',
      '/download/macos/%2e%2e%2fappcast.xml',
    ]) {
      const response = await call(path, { headers: { accept: 'text/html' } })
      expect(response.status, path).toBe(404)
      expect(response.headers.get('location'), path).toBeNull()
    }
  })

  it('/api/release 已删除，落到 /api 的 404', async () => {
    const response = await call('/api/release')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
  })
})
