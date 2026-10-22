import { verifyWebhook as sdkVerifyWebhook, WaffoPancake } from '@waffo/pancake-ts'
import type { Env, NotifyStore } from './env'
import { json } from './http'
import { clientIp, normalizeEmail, withinRateLimit } from './notify'

/**
 * Premium 的收费与许可证（Waffo Pancake 代收，见 docs/DEPLOY.md「收费」一节）。
 *
 * 没有账号系统：每次结账随机生成一个买家身份（`buyerIdentity`），凭证是付款成功后发出的许可证密钥。
 *
 * 1. `POST /api/checkout`：生成身份与「领取码」，用认证结账打开 Waffo 收银台；付完跳回 `/activate?claim=<领取码>`。
 * 2. `POST /api/waffo/webhook`：验签、核对店铺与环境、去重，再按身份更新许可证；首次激活时生成密钥并挂到领取码上。
 * 3. `GET /api/license/claim`：激活页轮询领取码，拿到密钥后交给客户端（首次领取后 1 小时内可重复读，之后失效）。
 * 4. `POST /api/license/verify`：客户端定期校验密钥是否仍有效。
 * 5. `POST /api/license/portal`：凭密钥换一个 Waffo 客户门户链接（取消、换卡、发票）。
 *
 * 为什么身份是随机的而不是从邮箱推导：结账会给这个身份签发 Waffo 的客户会话令牌，
 * 凭它能取消订阅、查看订单。如果身份能由邮箱算出来，知道别人邮箱的人就能拿到别人的令牌。
 * 代价是 Waffo 按身份记试用，换身份可以再领一次试用——每次都要填真卡、试用只有 1–3 天，可以接受。
 *
 * 为什么按身份而不是按订单存许可证：换套餐时 Waffo 会生成新订单（`plan_changed` 带的是新订单号），
 * 身份不变。按订单存，许可证会留在旧订单上随它过期。
 *
 * KV 里只存密钥的哈希，泄露了也拿不到密钥。没配齐 Waffo 的变量与私钥时，所有收费接口都回 503。
 */

export const PLANS = ['premium-monthly', 'premium-yearly'] as const
export type Plan = (typeof PLANS)[number]

/** 领取码与 webhook 去重记录的保留时长：够访客付完款回来，也够 Waffo 重试完 */
const CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60
/** 首次领到密钥后，领取码还能再读多久（刷新激活页用）；过了就失效，地址泄露也拿不到密钥 */
const CLAIM_REVEAL_WINDOW_MS = 60 * 60 * 1000
/** 续费失败或 webhook 晚到时的宽限期：账期结束后再多认这么久 */
const GRACE_MS = 3 * 24 * 60 * 60 * 1000
/** Waffo 的订阅状态里仍然算「已付费」的几种 */
const ENTITLED_STATUSES = new Set(['active', 'canceling', 'past_due'])
/** 进入后同一订单不再回退的状态：晚到的重试或旧事件不能把它们改回「有效」 */
const TERMINAL_STATUSES = new Set(['canceled', 'refunded'])
/** 每个 IP 每分钟的次数。客户端会定期校验，所以 verify 宽一些；同一网络下可能有很多台 Mac */
const LIMITS = { checkout: 5, portal: 5, claim: 60, verify: 60 } as const

export interface WaffoConfig {
  environment: 'test' | 'prod'
  merchantId: string
  privateKey: string
  storeId: string
  products: Record<Plan, string>
}

/** 读 Waffo 配置；缺任何一项都返回 null，调用方回 503 而不是带着半套配置去收钱 */
export function waffoConfig(env: Env): WaffoConfig | null {
  const environment = env.WAFFO_ENV === 'prod' ? 'prod' : env.WAFFO_ENV === 'test' ? 'test' : null
  const values = [
    env.WAFFO_MERCHANT_ID,
    env.WAFFO_PRIVATE_KEY,
    env.WAFFO_STORE_ID,
    env.WAFFO_PRODUCT_PREMIUM_MONTHLY,
    env.WAFFO_PRODUCT_PREMIUM_YEARLY,
  ]
  if (!environment || values.some((value) => !value)) return null
  return {
    environment,
    merchantId: env.WAFFO_MERCHANT_ID as string,
    privateKey: env.WAFFO_PRIVATE_KEY as string,
    storeId: env.WAFFO_STORE_ID as string,
    products: {
      'premium-monthly': env.WAFFO_PRODUCT_PREMIUM_MONTHLY as string,
      'premium-yearly': env.WAFFO_PRODUCT_PREMIUM_YEARLY as string,
    },
  }
}

/** SDK 里我们用到的那一小块。测试用假实现替身，不打网络 */
export interface WaffoClient {
  createCheckout(params: {
    productId: string
    buyerIdentity: string
    buyerEmail: string
    successUrl: string
    metadata: Record<string, string>
  }): Promise<{ checkoutUrl: string }>
  createPortalLink(params: {
    storeId: string
    buyerIdentity: string
  }): Promise<{ portalUrl: string }>
}

export function sdkClient(config: WaffoConfig): WaffoClient {
  const client = new WaffoPancake({ merchantId: config.merchantId, privateKey: config.privateKey })
  return {
    async createCheckout(params) {
      const result = await client.checkout.authenticated.create({
        ...params,
        currency: 'USD',
        // 试用期设在 Waffo 的商品上；这里只是声明「这次结账允许走试用」
        withTrial: true,
      })
      return { checkoutUrl: result.checkoutUrl }
    },
    async createPortalLink(params) {
      const { portalUrl } = await client.auth.createCustomerPortalLink(params)
      return { portalUrl }
    },
  }
}

/** Webhook 事件里我们读的字段（SDK 的 WebhookEvent 结构上满足它） */
export interface BillingEvent {
  /** 投递记录 ID。同一订单的不同事件可能相同，**不能单独用来去重** */
  id: string
  /** 业务事件 ID；与 `eventType` 一起才是唯一的（Waffo 文档：按事件类型 + eventId 去重） */
  eventId: string
  eventType: string
  /** 事件发生时间（ISO 8601），重试不会改它；用来丢弃晚到的旧事件 */
  timestamp: string
  mode: string
  /** 签名密钥是平台级的（所有店铺共用），所以必须核对事件属于我们的店铺 */
  storeId: string
  data: {
    orderId: string
    orderStatus?: string
    merchantProvidedBuyerIdentity?: string
    orderMetadata?: Record<string, string>
    billingPeriod?: string
    currentPeriodEnd?: string
  }
}

export type VerifyWebhook = (body: string, signature: string, config: WaffoConfig) => BillingEvent

const sdkVerify: VerifyWebhook = (body, signature, config) =>
  sdkVerifyWebhook(body, signature, { environment: config.environment }) as BillingEvent

export interface BillingDeps {
  client?: (config: WaffoConfig) => WaffoClient
  verify?: VerifyWebhook
  now?: () => Date
}

// ---------------------------------------------------------------- 身份与密钥

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** 每次结账一个新身份：不可由任何访客能提供的信息推导出来（见文件头） */
export function newBuyerIdentity(): string {
  return `u_${base64url(crypto.getRandomValues(new Uint8Array(18)))}`
}

/** Crockford Base32：去掉了 I / L / O / U，抄错一个字符的可能更小 */
const KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** `UMUO-XXXXX-XXXXX-XXXXX-XXXXX`：20 个字符、100 位随机 */
export function newLicenseKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  const chars = [...bytes].map((byte) => KEY_ALPHABET[byte & 31])
  const groups = [0, 5, 10, 15].map((start) => chars.slice(start, start + 5).join(''))
  return `UMUO-${groups.join('-')}`
}

/** 用户可能带着空格、小写或换行粘贴密钥；统一之后再算哈希 */
export function normalizeLicenseKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toUpperCase()
  return /^UMUO(-[0-9A-HJKMNP-TV-Z]{5}){4}$/.test(key) ? key : null
}

export async function licenseKeyHash(key: string): Promise<string> {
  return base64url(await sha256(key))
}

export function newClaimToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)))
}

/** Waffo 的计费周期 → 我们的套餐名；换套餐后靠它更新 */
function planFromPeriod(period: string | undefined): Plan | null {
  if (period === 'monthly') return 'premium-monthly'
  if (period === 'yearly') return 'premium-yearly'
  return null
}

// ---------------------------------------------------------------- 记录

export interface ClaimRecord {
  status: 'pending' | 'ready'
  plan: Plan
  /** 这次结账的买家身份：激活事件的身份对得上，才把密钥交给这张领取码 */
  identity: string
  key?: string
  /** 第一次被读到密钥的时间（ISO 8601）；过了 CLAIM_REVEAL_WINDOW_MS 就不再给 */
  revealedAt?: string
}

export interface LicenseRecord {
  identity: string
  /** 当前生效的订单；换套餐后指向新订单 */
  orderId: string
  plan: string
  status: string
  currentPeriodEnd: string | null
  keyHash: string | null
  mode: string
  /** 最后一次被采纳的事件时间：比它旧的事件一律忽略 */
  lastEventAt: string
  updatedAt: string
}

const claimKey = (token: string) => `claim:${token}`
const licenseKey = (identity: string) => `lic:${identity}`
const orderIndex = (orderId: string) => `order:${orderId}`
const keyIndex = (hash: string) => `key:${hash}`
const deliveryKey = (event: BillingEvent) => `whk:${event.eventType}:${event.eventId}`

async function readJson<T>(store: NotifyStore, key: string): Promise<T | null> {
  const raw = await store.get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * 许可证此刻是否有效。账期结束后再给 3 天宽限：续费失败要重试、webhook 也可能晚到，
 * 不该因为这几个小时把付费用户降级。
 */
export function isEntitled(record: LicenseRecord, now: Date): boolean {
  if (!ENTITLED_STATUSES.has(record.status)) return false
  if (!record.currentPeriodEnd) return true
  const end = Date.parse(record.currentPeriodEnd)
  if (Number.isNaN(end)) return true
  // currentPeriodEnd 可能只有日期（`2026-05-10`），按当天结束算
  const endOfDay = record.currentPeriodEnd.length <= 10 ? end + 24 * 60 * 60 * 1000 : end
  return now.getTime() <= endOfDay + GRACE_MS
}

// ---------------------------------------------------------------- 接口

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json()
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const notConfigured = () => json({ ok: false, error: 'billing_not_configured' }, 503)
const rateLimited = () => json({ ok: false, error: 'rate_limited' }, 429)
const methodNotAllowed = (allow: string) =>
  json({ ok: false, error: 'method_not_allowed' }, 405, { allow })

const allowed = (request: Request, env: Env, scope: keyof typeof LIMITS) =>
  withinRateLimit(env.LICENSES, clientIp(request), scope, LIMITS[scope])

/** `POST /api/checkout` `{ plan, email }` → `{ checkoutUrl }`（前端在新标签页打开它） */
export async function handleCheckout(
  request: Request,
  env: Env,
  deps: BillingDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const config = waffoConfig(env)
  if (!config) return notConfigured()

  const body = await readBody(request)
  const plan = PLANS.find((item) => item === body?.plan)
  if (!plan) return json({ ok: false, error: 'invalid_plan' }, 400)
  const email = normalizeEmail(body?.email)
  if (!email) return json({ ok: false, error: 'invalid_email' }, 400)
  if (!(await allowed(request, env, 'checkout'))) return rateLimited()

  const token = newClaimToken()
  const identity = newBuyerIdentity()
  const claim: ClaimRecord = { status: 'pending', plan, identity }
  await env.LICENSES.put(claimKey(token), JSON.stringify(claim), {
    expirationTtl: CLAIM_TTL_SECONDS,
  })

  const successUrl = new URL('/activate', request.url)
  successUrl.searchParams.set('claim', token)
  try {
    const { checkoutUrl } = await (deps.client ?? sdkClient)(config).createCheckout({
      productId: config.products[plan],
      buyerIdentity: identity,
      // 只用来预填收银台的邮箱栏，不参与身份
      buyerEmail: email,
      successUrl: successUrl.toString(),
      metadata: { claim: token },
    })
    return json({ ok: true, checkoutUrl })
  } catch {
    // 不把 SDK 的错误细节回给浏览器：里面可能有商户 ID、商品 ID
    return json({ ok: false, error: 'checkout_failed' }, 502)
  }
}

/** `POST /api/waffo/webhook`：必须读原始文本再验签，先解析 JSON 会让签名失效 */
export async function handleWebhook(
  request: Request,
  env: Env,
  deps: BillingDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const config = waffoConfig(env)
  if (!config) return notConfigured()

  const body = await request.text()
  const signature = request.headers.get('x-waffo-signature') ?? ''
  let event: BillingEvent
  try {
    event = (deps.verify ?? sdkVerify)(body, signature, config)
  } catch {
    return json({ ok: false, error: 'invalid_signature' }, 401)
  }
  // 签名密钥是平台级的：别的店铺的合法事件也能验签通过，必须核对店铺
  if (event.storeId !== config.storeId) return json({ ok: true, ignored: 'store' })
  // 测试环境的事件不能改正式环境的许可证，反之亦然
  if (event.mode !== config.environment) return json({ ok: true, ignored: 'mode' })
  // Waffo 会重试投递；同一类型的同一事件只处理一次
  if (await env.LICENSES.get(deliveryKey(event))) return json({ ok: true, duplicate: true })

  await applyEvent(env.LICENSES, event, (deps.now ?? (() => new Date()))())
  await env.LICENSES.put(deliveryKey(event), '1', { expirationTtl: CLAIM_TTL_SECONDS })
  return json({ ok: true })
}

/**
 * 按买家身份更新许可证。订阅类事件都带 `orderStatus`，所以不逐个分支，只守住四条规则：
 *
 * 1. 只认当前订单的事件；`plan_changed` 例外，它把许可证切到新订单（身份不变，密钥跟过去）。
 * 2. 比上次采纳的事件旧的一律忽略（重试与跨地域的 KV 读旧都会让事件乱序到达）。
 * 3. 已取消、已退款的订单不再回退。
 * 4. 只有 `subscription.activated` 生成密钥；身份与领取码对得上才交出去。
 */
export async function applyEvent(store: NotifyStore, event: BillingEvent, now: Date) {
  const { data } = event
  const claimToken = data.orderMetadata?.claim
  const claim = claimToken ? await readJson<ClaimRecord>(store, claimKey(claimToken)) : null
  const identity =
    data.merchantProvidedBuyerIdentity ??
    claim?.identity ??
    (await store.get(orderIndex(data.orderId)))
  // 不是我们结账发起的订单（没有身份可对），不碰
  if (!identity) return
  await store.put(orderIndex(data.orderId), identity)

  const existing = await readJson<LicenseRecord>(store, licenseKey(identity))
  const sameOrder = existing?.orderId === data.orderId
  if (existing && Date.parse(event.timestamp) < Date.parse(existing.lastEventAt)) return

  if (event.eventType === 'refund.succeeded') {
    // 退款即收回 Premium（我们的退款都是全额）
    if (existing && sameOrder) await save({ ...existing, status: 'refunded' })
    return
  }
  if (!event.eventType.startsWith('subscription.') || !data.orderStatus) return
  // 预约换套餐时新订单还是 pending、没有账期；生效时会再来一条 plan_changed
  if (event.eventType === 'subscription.plan_change_scheduled') return
  if (event.eventType === 'subscription.plan_change_failed') return
  if (existing && !sameOrder && event.eventType !== 'subscription.plan_changed') return
  if (existing && sameOrder && TERMINAL_STATUSES.has(existing.status)) return

  const record: LicenseRecord = {
    identity,
    orderId: data.orderId,
    plan:
      planFromPeriod(data.billingPeriod) ??
      (existing?.plan as Plan | undefined) ??
      claim?.plan ??
      'premium-monthly',
    status: data.orderStatus,
    currentPeriodEnd:
      data.currentPeriodEnd ?? (sameOrder ? existing?.currentPeriodEnd : null) ?? null,
    keyHash: existing?.keyHash ?? null,
    mode: event.mode,
    lastEventAt: event.timestamp,
    updatedAt: now.toISOString(),
  }

  if (event.eventType === 'subscription.activated' && !record.keyHash) {
    const key = newLicenseKey()
    record.keyHash = await licenseKeyHash(key)
    await store.put(keyIndex(record.keyHash), identity)
    if (claimToken && claim && claim.identity === identity) {
      const ready: ClaimRecord = { ...claim, status: 'ready', key }
      await store.put(claimKey(claimToken), JSON.stringify(ready), {
        expirationTtl: CLAIM_TTL_SECONDS,
      })
    }
  }
  await save(record)

  async function save(value: LicenseRecord) {
    await store.put(
      licenseKey(identity as string),
      JSON.stringify({ ...value, lastEventAt: event.timestamp }),
    )
  }
}

/**
 * `GET /api/license/claim?claim=<领取码>`：激活页轮询，付款成功后拿到密钥。
 * 第一次读到密钥后只再给 1 小时（够刷新页面），之后当作不存在——地址留在浏览器历史里也拿不到密钥。
 */
export async function handleClaim(
  request: Request,
  env: Env,
  deps: BillingDeps = {},
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  if (!(await allowed(request, env, 'claim'))) return rateLimited()
  const token = new URL(request.url).searchParams.get('claim') ?? ''
  const claim = token ? await readJson<ClaimRecord>(env.LICENSES, claimKey(token)) : null
  if (!claim) return json({ ok: false, error: 'unknown_claim' }, 404)
  if (claim.status !== 'ready') return json({ ok: true, status: 'pending', plan: claim.plan })

  const now = (deps.now ?? (() => new Date()))()
  if (!claim.revealedAt) {
    const revealed: ClaimRecord = { ...claim, revealedAt: now.toISOString() }
    await env.LICENSES.put(claimKey(token), JSON.stringify(revealed), {
      expirationTtl: CLAIM_TTL_SECONDS,
    })
  } else if (now.getTime() - Date.parse(claim.revealedAt) > CLAIM_REVEAL_WINDOW_MS) {
    return json({ ok: false, error: 'unknown_claim' }, 404)
  }
  return json({ ok: true, status: 'ready', plan: claim.plan, key: claim.key }, 200, {
    'referrer-policy': 'no-referrer',
  })
}

/** 密钥 → 许可证。只认记录里当前那把密钥的哈希：换过的旧密钥立即失效 */
async function findLicense(env: Env, rawKey: unknown): Promise<LicenseRecord | null> {
  const key = normalizeLicenseKey(rawKey)
  if (!key) return null
  const hash = await licenseKeyHash(key)
  const identity = await env.LICENSES.get(keyIndex(hash))
  const record = identity ? await readJson<LicenseRecord>(env.LICENSES, licenseKey(identity)) : null
  return record?.keyHash === hash ? record : null
}

/** `POST /api/license/verify` `{ key }` → 是否仍有 Premium。客户端缓存结果，离线时按缓存走 */
export async function handleVerify(
  request: Request,
  env: Env,
  deps: BillingDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  if (!(await allowed(request, env, 'verify'))) return rateLimited()
  const license = await findLicense(env, (await readBody(request))?.key)
  if (!license) return json({ ok: false, error: 'unknown_license' }, 404)
  const now = (deps.now ?? (() => new Date()))()
  return json({
    ok: true,
    entitled: isEntitled(license, now),
    plan: license.plan,
    status: license.status,
    currentPeriodEnd: license.currentPeriodEnd,
    checkedAt: now.toISOString(),
  })
}

/** `POST /api/license/portal` `{ key }` → Waffo 客户门户链接。链接是一次性凭证，不缓存 */
export async function handlePortal(
  request: Request,
  env: Env,
  deps: BillingDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const config = waffoConfig(env)
  if (!config) return notConfigured()
  if (!(await allowed(request, env, 'portal'))) return rateLimited()
  const license = await findLicense(env, (await readBody(request))?.key)
  if (!license) return json({ ok: false, error: 'unknown_license' }, 404)
  try {
    const { portalUrl } = await (deps.client ?? sdkClient)(config).createPortalLink({
      storeId: config.storeId,
      buyerIdentity: license.identity,
    })
    return json({ ok: true, portalUrl }, 200, { 'referrer-policy': 'no-referrer' })
  } catch {
    return json({ ok: false, error: 'portal_failed' }, 502)
  }
}
