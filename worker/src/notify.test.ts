import { describe, expect, it } from 'vitest'
import type { Env, NotifyStore } from './env'
import worker from './index'
import {
  clientIp,
  handleHealth,
  handleNotify,
  normalizeEmail,
  normalizeSource,
  notifyKey,
  parseRecord,
  RATE_LIMIT,
  RATE_WINDOW_SECONDS,
  rateLimitKey,
  withinRateLimit,
} from './notify'

/**
 * 假的 KV：只实现 `NotifyStore` 需要的两个方法。
 * 真的 `KVNamespace` 结构上满足同一个接口，所以这里不需要为了过类型检查
 * 去伪造整个 KV API，也不会因为 wrangler 改了类型而跟着坏。
 */
function fakeStore(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial))
  const ttls: Record<string, number | undefined> = {}
  const store: NotifyStore = {
    async get(key) {
      return entries.get(key) ?? null
    },
    async put(key, value, options) {
      entries.set(key, value)
      ttls[key] = options?.expirationTtl
    },
  }
  return { store, entries, ttls }
}

function makeEnv(store: NotifyStore): Env {
  return { NOTIFY_KV: store }
}

function notifyRequest(body: unknown, init: RequestInit = {}) {
  return new Request('https://umuo.app/api/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })
}

describe('normalizeEmail', () => {
  it('去空白并小写化', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com')
  })

  it('放行 +tag、子域名与新 TLD —— 误拒合法地址比多发一封信贵', () => {
    expect(normalizeEmail('ada+launch@mail.example.co.uk')).toBe('ada+launch@mail.example.co.uk')
    expect(normalizeEmail('中文@example.com')).toBe('中文@example.com')
  })

  it('挡掉明显不是地址的输入', () => {
    for (const bad of ['', '   ', 'not-an-email', 'a@b', 'a b@c.com', '@example.com', 'a@.com']) {
      expect(normalizeEmail(bad)).toBeNull()
    }
  })

  it('挡掉非字符串与超长输入', () => {
    for (const bad of [null, undefined, 42, {}, ['a@b.com']]) {
      expect(normalizeEmail(bad)).toBeNull()
    }
    expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull()
  })
})

describe('normalizeSource', () => {
  it('去空白、去控制字符与零宽字符', () => {
    expect(normalizeSource('  macOS  ')).toBe('macOS')
    expect(normalizeSource('Pro\n\r\u200b')).toBe('Pro')
  })

  it('截断到 64 字符，避免来源字段变成存任意文本的入口', () => {
    expect(normalizeSource('x'.repeat(200))).toHaveLength(64)
  })

  it('非字符串或空串给 undefined', () => {
    for (const bad of [null, 42, {}, '   ', '\n']) {
      expect(normalizeSource(bad)).toBeUndefined()
    }
  })
})

describe('键与记录解析', () => {
  it('键的形状固定，且能一眼看出是什么', () => {
    expect(notifyKey('a@b.com')).toBe('notify:a@b.com')
    expect(rateLimitKey('203.0.113.7')).toBe('rl:notify:203.0.113.7')
  })

  it('解析自己写下的记录', () => {
    const raw = JSON.stringify({
      email: 'a@b.com',
      source: 'macOS',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-02T00:00:00.000Z',
    })
    expect(parseRecord(raw)).toEqual({
      email: 'a@b.com',
      source: 'macOS',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-02T00:00:00.000Z',
    })
  })

  it('被人工改坏的值当作「没有」，而不是让请求 500', () => {
    for (const bad of [null, '', 'not json', '{}', '{"email":42}', '{"email":"a@b.com"}', '[]']) {
      expect(parseRecord(bad)).toBeNull()
    }
  })
})

describe('withinRateLimit', () => {
  it('前 N 次放行，第 N+1 次拦住', async () => {
    const { store } = fakeStore()
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      expect(await withinRateLimit(store, '203.0.113.7')).toBe(true)
    }
    expect(await withinRateLimit(store, '203.0.113.7')).toBe(false)
  })

  it('计数器带 TTL，窗口过后自己消失', async () => {
    const { store, ttls } = fakeStore()
    await withinRateLimit(store, '203.0.113.7')
    expect(ttls[rateLimitKey('203.0.113.7')]).toBe(RATE_WINDOW_SECONDS)
  })

  it('不同 IP 各算各的', async () => {
    const { store } = fakeStore()
    for (let i = 0; i < RATE_LIMIT; i += 1) await withinRateLimit(store, '198.51.100.1')
    expect(await withinRateLimit(store, '203.0.113.7')).toBe(true)
  })

  it('计数器被写坏时按「没用过」处理，而不是永远拦住', async () => {
    const { store } = fakeStore({ [rateLimitKey('203.0.113.7')]: 'oops' })
    expect(await withinRateLimit(store, '203.0.113.7')).toBe(true)
  })
})

describe('handleNotify', () => {
  it('存下邮箱与来源，并回 {ok:true}', async () => {
    const { store, entries } = fakeStore()
    const response = await handleNotify(
      notifyRequest({ email: 'Ada@Example.com', source: 'macOS' }),
      makeEnv(store),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(JSON.parse(entries.get(notifyKey('ada@example.com')) ?? '{}')).toMatchObject({
      email: 'ada@example.com',
      source: 'macOS',
    })
  })

  it('重复提交不覆盖 firstSeenAt ——「第一次愿意留邮箱」才是要的数据', async () => {
    const { store, entries } = fakeStore({
      [notifyKey('ada@example.com')]: JSON.stringify({
        email: 'ada@example.com',
        source: 'macOS',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }),
    })
    const response = await handleNotify(
      notifyRequest({ email: 'ada@example.com', source: 'Pro' }),
      makeEnv(store),
    )

    expect(response.status).toBe(200)
    const saved = JSON.parse(entries.get(notifyKey('ada@example.com')) ?? '{}')
    expect(saved.firstSeenAt).toBe('2026-01-01T00:00:00.000Z')
    expect(saved.lastSeenAt).not.toBe('2026-01-01T00:00:00.000Z')
    expect(saved.source).toBe('Pro')
  })

  it('邮箱不合法时 400，且什么都不写', async () => {
    const { store, entries } = fakeStore()
    const response = await handleNotify(notifyRequest({ email: 'nope' }), makeEnv(store))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_email' })
    expect(entries.size).toBe(0)
  })

  it('body 不是 JSON 或不是对象时 400 invalid_body', async () => {
    const { store } = fakeStore()
    for (const body of ['{oops', 'null', '"a@b.com"']) {
      const response = await handleNotify(notifyRequest(body), makeEnv(store))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_body' })
    }
  })

  it('非 POST 时 405 并声明 Allow', async () => {
    const { store } = fakeStore()
    const response = await handleNotify(
      new Request('https://umuo.app/api/notify', { method: 'GET' }),
      makeEnv(store),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('超过限流后 429，且那一次不落库', async () => {
    const { store, entries } = fakeStore()
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      await handleNotify(notifyRequest({ email: `a${i}@example.com` }), makeEnv(store))
    }
    const response = await handleNotify(
      notifyRequest({ email: 'last@example.com' }),
      makeEnv(store),
    )

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ ok: false, error: 'rate_limited' })
    expect(entries.has(notifyKey('last@example.com'))).toBe(false)
  })

  it('响应里不回显邮箱', async () => {
    const { store } = fakeStore()
    const response = await handleNotify(notifyRequest({ email: 'ada@example.com' }), makeEnv(store))
    expect(await response.text()).not.toContain('ada@example.com')
  })

  it('响应不可缓存', async () => {
    const { store } = fakeStore()
    const response = await handleNotify(notifyRequest({ email: 'a@b.com' }), makeEnv(store))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('handleHealth', () => {
  it('KV 可读时返回 ok', async () => {
    const { store } = fakeStore()
    const response = await handleHealth(makeEnv(store))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, service: 'umuo-app' })
  })

  it('KV 绑定坏掉时 503，而不是等第一封订阅进来才发现', async () => {
    const broken: NotifyStore = {
      async get() {
        throw new Error('binding missing')
      },
      async put() {},
    }
    const response = await handleHealth(makeEnv(broken))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'kv_unavailable' })
  })
})

describe('路由', () => {
  it('/api/notify 交给通知处理', async () => {
    const { store } = fakeStore()
    const response = await worker.fetch(notifyRequest({ email: 'a@b.com' }), makeEnv(store))
    expect(response.status).toBe(200)
  })

  it('/api/health 交给健康检查', async () => {
    const { store } = fakeStore()
    const response = await worker.fetch(new Request('https://umuo.app/api/health'), makeEnv(store))
    expect(await response.json()).toEqual({ ok: true, service: 'umuo-app' })
  })

  it('未知的 /api 路径 404，而不是回一个首页副本', async () => {
    const { store } = fakeStore()
    const response = await worker.fetch(new Request('https://umuo.app/api/nope'), makeEnv(store))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
  })

  it('静态资源没命中时回 HTML 404 —— 浏览器不该看到一屏 JSON', async () => {
    const { store } = fakeStore()
    const response = await worker.fetch(new Request('https://umuo.app/nope-page'), makeEnv(store))
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    // 得有一条回首页的路，否则用户只能自己改地址栏
    expect(html).toContain('href="/"')
    expect(html).not.toContain('{"ok"')
  })
})

describe('clientIp', () => {
  it('读 Cloudflare 覆写的 header，客户端伪造不了', () => {
    expect(clientIp(notifyRequest({ email: 'a@b.com' }))).toBe('203.0.113.7')
    expect(clientIp(new Request('https://umuo.app/api/notify'))).toBe('unknown')
  })
})
