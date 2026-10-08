import { describe, expect, it } from 'vitest'
import type { Env, ReleaseObject } from './env'
import worker from './index'
import { LATEST_KEY } from './releases'

/** 假的 R2：按 key 放字符串，只实现 Worker 用到的读接口。 */
function fakeReleases(files: Record<string, string>): Env {
  return {
    NOTIFY_KV: { get: async () => null, put: async () => {} },
    RELEASES: {
      async get(key): Promise<ReleaseObject | null> {
        const content = files[key]
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

const manifest = {
  version: '0.1.7',
  key: 'macos/umuo-0.1.7-universal.dmg',
  size: 4,
  sha256: 'abc',
  commit: 'deadbeef',
  publishedAt: '2026-10-08T00:00:00Z',
}

const call = (path: string, env: Env) => worker.fetch(new Request(`https://umuo.app${path}`), env)

describe('安装包下载', () => {
  it('按 latest.json 给出最新版，文件名带版本号、不缓存', async () => {
    const env = fakeReleases({
      [LATEST_KEY]: JSON.stringify(manifest),
      [manifest.key]: 'DMG!',
    })
    const response = await call('/download/macos', env)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="umuo-0.1.7.dmg"',
    )
    expect(response.headers.get('content-type')).toBe('application/x-apple-diskimage')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('DMG!')
  })

  it('还没发布过时说「正在准备」，而不是 404 或坏文件', async () => {
    const response = await call('/download/macos', fakeReleases({}))
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('latest.json 指向的文件不在时同样说「正在准备」', async () => {
    const response = await call(
      '/download/macos',
      fakeReleases({ [LATEST_KEY]: JSON.stringify(manifest) }),
    )
    expect(response.status).toBe(503)
  })

  it('latest.json 损坏时不把人引到坏链接', async () => {
    const response = await call('/download/macos', fakeReleases({ [LATEST_KEY]: '{not json' }))
    expect(response.status).toBe(503)
  })
})

describe('/api/release', () => {
  it('返回最新版的元数据', async () => {
    const env = fakeReleases({ [LATEST_KEY]: JSON.stringify(manifest) })
    const response = await call('/api/release', env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, macos: manifest })
  })

  it('没有版本时 404', async () => {
    const response = await call('/api/release', fakeReleases({}))
    expect(response.status).toBe(404)
  })
})
