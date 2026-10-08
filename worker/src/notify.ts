import type { Env, NotifyStore } from './env'
import { json } from './http'

/**
 * 上线通知：官网「发布时通知你」表单的服务端。
 *
 * 只做三件事：校验邮箱、把地址写进 KV、挡住明显的滥用。
 * **不发信**——发信依赖还没定的服务商，先把名单收下来。
 */
export interface NotifyRecord {
  email: string
  /** 从哪个卡片提交的（平台名或方案名），只用于区分来源 */
  source?: string
  /** 第一次订阅的时间。重复提交不会覆盖它——'第一次愿意留邮箱'才是我们要的数据 */
  firstSeenAt: string
  lastSeenAt: string
}

/** RFC 5321 的地址长度上限；超过它的一定不是真实地址 */
const MAX_EMAIL_LENGTH = 254
/** 来源字段只是个标签，截断它，别让它变成存任意文本的入口 */
const MAX_SOURCE_LENGTH = 64

/** 每个 IP 每个窗口内的提交上限 */
export const RATE_LIMIT = 5
export const RATE_WINDOW_SECONDS = 60

/**
 * 邮箱规范化与校验。
 *
 * 正则刻意保守：小写化 + 去空白，形状上要求「有 @、域名里有 .、没有空白」。
 * 真正的验证是「我们能不能往这个地址发信」——多发一封的成本远低于误拒一个
 * 合法地址（`+tag`、国际化域名、新 TLD 都要放过去）。
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (!email || email.length > MAX_EMAIL_LENGTH) return null
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null
  return email
}

/**
 * 来源标签：去掉控制字符并截断。
 *
 * 它会被存下来、将来也可能被导出来看，所以不能是「用户想写什么就写什么」
 * 的任意字符串——换行与控制字符会污染导出，长度则决定单条记录的大小。
 */
export function normalizeSource(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  // \p{Cc} 是控制字符、\p{Cf} 是零宽/格式字符：前者会在导出时把一行拆成两行，
  // 后者会造出「看起来一样但字节不同」的重复来源标签
  const value = raw.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  return value ? value.slice(0, MAX_SOURCE_LENGTH) : undefined
}

export function notifyKey(email: string): string {
  return `notify:${email}`
}

export function rateLimitKey(ip: string): string {
  return `rl:notify:${ip}`
}

/**
 * 读回自己写下的记录。KV 里的值可能被人工改坏，所以这里解析失败就当作没有，
 * 而不是让整个请求 500 —— 丢一条来源标签好过丢一次订阅。
 */
export function parseRecord(raw: string | null): NotifyRecord | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const record = value as Partial<NotifyRecord>
    if (typeof record.email !== 'string') return null
    const firstSeenAt = typeof record.firstSeenAt === 'string' ? record.firstSeenAt : ''
    const lastSeenAt = typeof record.lastSeenAt === 'string' ? record.lastSeenAt : ''
    if (!firstSeenAt || !lastSeenAt) return null
    return {
      email: record.email,
      source: typeof record.source === 'string' ? record.source : undefined,
      firstSeenAt,
      lastSeenAt,
    }
  } catch {
    return null
  }
}

/**
 * 固定窗口计数。KV 没有原子自增，所以并发请求可能同时读到同一个计数 ——
 * 这是「降低滥用」，不是硬性配额。对一个低价值的订阅端点，这个强度够了；
 * 写成这样而不是上 Durable Object，是因为后者会让**每个 PR 的预览构建失败**
 * （DO 迁移不能由 `wrangler versions upload` 应用）。
 */
export async function withinRateLimit(store: NotifyStore, ip: string): Promise<boolean> {
  const key = rateLimitKey(ip)
  const used = Number((await store.get(key)) ?? 0)
  if (!Number.isFinite(used) || used < 0) return true
  if (used >= RATE_LIMIT) return false
  await store.put(key, String(used + 1), { expirationTtl: RATE_WINDOW_SECONDS })
  return true
}

/** 提交来源的 IP。Cloudflare 会覆写这个 header，客户端伪造不了。 */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}

export async function handleNotify(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, { allow: 'POST' })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }
  if (typeof payload !== 'object' || payload === null) {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  const body = payload as Record<string, unknown>
  const email = normalizeEmail(body.email)
  if (!email) return json({ ok: false, error: 'invalid_email' }, 400)

  if (!(await withinRateLimit(env.NOTIFY_KV, clientIp(request)))) {
    return json({ ok: false, error: 'rate_limited' }, 429)
  }

  const now = new Date().toISOString()
  const key = notifyKey(email)
  const existing = parseRecord(await env.NOTIFY_KV.get(key))
  const record: NotifyRecord = {
    email,
    source: normalizeSource(body.source),
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
  }
  await env.NOTIFY_KV.put(key, JSON.stringify(record))

  // 不回显邮箱：响应可能进日志、进浏览器开发者工具，没必要带上 PII。
  return json({ ok: true })
}

/**
 * 给部署后一个不要账号就能用的探针：`curl -s https://umuo.app/api/health`。
 * 顺手读一次 KV —— 绑定写错（id 指到别的 namespace、或没绑上）时它会 503，
 * 而不是等第一封订阅进来才发现。
 */
export async function handleHealth(env: Env): Promise<Response> {
  try {
    await env.NOTIFY_KV.get('health:probe')
  } catch {
    return json({ ok: false, error: 'kv_unavailable' }, 503)
  }
  return json({ ok: true, service: 'umuo-app' })
}
