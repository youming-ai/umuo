import { describe, expect, it } from 'vitest'
import { dispatch } from './dispatch'
import type { Env } from './env'
import { GITHUB_LATEST } from './releases'

/** 下载只做跳转，不读任何绑定；静态资源层一律 404，确认旧地址落到 Worker 自己的 404 页。 */
const env: Env = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
}

const call = (path: string, init?: RequestInit) =>
  dispatch(new Request(`https://umuo.app${path}`, init), env)

describe('安装包下载', () => {
  it('/download/macos 302 到 GitHub 最新 Release 的 umuo.dmg，不缓存', async () => {
    const response = await call('/download/macos')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://github.com/youming-ai/umuo/releases/latest/download/umuo.dmg',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('HEAD 同样跳转', async () => {
    const response = await call('/download/macos', { method: 'HEAD' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${GITHUB_LATEST}/umuo.dmg`)
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
