import { verifyWebhook as sdkVerifyWebhook, WaffoPancake } from '@waffo/pancake-ts'
import type { Env, NotifyStore } from './env'
import { json } from './http'
import { clientIp, normalizeEmail, withinRateLimit } from './notify'

/**
 * 一次性买断的收费与许可证（Waffo Pancake 代收，见 docs/DEPLOY.md「收费」一节）。
 *
 * 商业规则：US$9 买断（不含税，Waffo 按地区计税）；每个许可证最多激活 3 台 Mac，可凭密钥自助解绑换机；
 * 购买 14 天内可退款，退款后许可证吊销；7 天试用由客户端本地处理，服务端不管试用。
 *
 * 没有账号系统：每次结账随机生成一个买家身份（`buyerIdentity`），凭证是付款成功后发出的许可证密钥。
 *
 * 1. `POST /api/checkout`：生成身份与「领取码」，用认证结账打开 Waffo 收银台；付完跳回 `/activate?claim=<领取码>`。
 * 2. `POST /api/waffo/webhook`：验签、核对店铺与环境、去重；`order.completed` 签发许可证并挂到领取码上，
 *    `refund.succeeded` 吊销。
 * 3. `GET /api/license/claim`：激活页轮询领取码，拿到密钥（首次领取后 1 小时内可重复读，之后失效）。
 * 4. `POST /api/license/activate` / `deactivate`：客户端用密钥登记、解绑本机（最多 3 台）。
 * 5. `POST /api/license/verify`：客户端定期校验本机的许可证状态。
 * 6. `POST /api/license/portal`：凭密钥换一个 Waffo 客户门户链接（发票、退款申请）。
 *
 * 为什么身份是随机的而不是从邮箱推导：结账会给这个身份签发 Waffo 的客户会话令牌，
 * 凭它能进客户门户、查看订单。如果身份能由邮箱算出来，知道别人邮箱的人就能拿到别人的令牌。
 *
 * 许可证与索引里只存密钥的哈希，泄露了也拿不到密钥；明文密钥只暂存在领取码上，
 * 激活页读走后 1 小时（没人读则 7 天）随领取码一起过期。没配齐 Waffo 的变量与私钥时，结账、webhook 与门户回 503。
 *
 * KV 是最终一致的：同一许可证在两台 Mac 上几乎同时激活，读改写可能互相覆盖，偶尔多登记一台或丢一台。
 * 对 US$9 的买断可以接受；换成 Durable Object 才能做到严格计数。
 */

/** 每个许可证最多同时激活的 Mac 数量 */
export const MAX_DEVICES = 3
/** 领取码与 webhook 去重记录的保留时长：够访客付完款回来，也够 Waffo 重试完 */
const CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60
/** 首次领到密钥后，领取码还能再读多久（刷新激活页用）；过了就失效，地址泄露也拿不到密钥 */
const CLAIM_REVEAL_WINDOW_MS = 60 * 60 * 1000
/** 设备 ID 与设备名的长度上限：二者都会进 KV、再原样回给客户端 */
const MAX_DEVICE_ID_LENGTH = 128
const MAX_DEVICE_NAME_LENGTH = 64
/**
 * 每个 IP 每分钟的次数。客户端会定期校验，所以 verify 宽一些；同一网络下可能有很多台 Mac。
 * 激活与解绑是人手动点的，次数少；但要挡住拿密钥批量试设备的脚本。
 */
const LIMITS = {
  checkout: 5,
  portal: 5,
  claim: 60,
  verify: 60,
  activate: 20,
  deactivate: 20,
} as const

/** 官网的五种语言 → Waffo 收银台的默认语言；访客在收银台上仍可以自己切换 */
const CASHIER_LANGUAGE = {
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant-TW',
  en: 'en',
  ja: 'ja-JP',
  ko: 'ko-KR',
} as const
type CashierLanguage = (typeof CASHIER_LANGUAGE)[keyof typeof CASHIER_LANGUAGE]

export interface WaffoConfig {
  environment: 'test' | 'prod'
  merchantId: string
  privateKey: string
  storeId: string
  /** 一次性买断商品（US$9）的 ID */
  productId: string
}

/** 读 Waffo 配置；缺任何一项都返回 null，调用方回 503 而不是带着半套配置去收钱 */
export function waffoConfig(env: Env): WaffoConfig | null {
  const environment = env.WAFFO_ENV === 'prod' ? 'prod' : env.WAFFO_ENV === 'test' ? 'test' : null
  const values = [
    env.WAFFO_MERCHANT_ID,
    env.WAFFO_PRIVATE_KEY,
    env.WAFFO_STORE_ID,
    env.WAFFO_PRODUCT_LICENSE,
  ]
  if (!environment || values.some((value) => !value)) return null
  return {
    environment,
    merchantId: env.WAFFO_MERCHANT_ID as string,
    privateKey: env.WAFFO_PRIVATE_KEY as string,
    storeId: env.WAFFO_STORE_ID as string,
    productId: env.WAFFO_PRODUCT_LICENSE as string,
  }
}

/** SDK 里我们用到的那一小块。测试用假实现替身，不打网络 */
export interface WaffoClient {
  createCheckout(params: {
    productId: string
    buyerIdentity: string
    buyerEmail?: string
    language?: CashierLanguage
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
      // 一次性商品：不传 withTrial（SDK 注明只对订阅有效），试用由客户端本地处理
      const result = await client.checkout.authenticated.create({ ...params, currency: 'USD' })
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
  /** 投递记录 ID；实际投递里同一订单的不同事件可能相同，**不能单独用来去重** */
  id: string
  /** 业务事件 ID（付款号、退款号）；与 `eventType` 一起才是唯一的（Waffo 文档：按事件类型 + eventId 去重） */
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

/** 去掉控制字符与零宽字符后的非空串，超长截断；不是字符串或清洗后为空时返回 null */
function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  return value ? value.slice(0, max) : null
}

/** 设备 ID 由客户端生成，只作比对用：超长直接拒绝（截断会让两台设备撞成同一个） */
function normalizeDeviceId(raw: unknown): string | null {
  const value = cleanText(raw, MAX_DEVICE_ID_LENGTH + 1)
  return value && value.length <= MAX_DEVICE_ID_LENGTH ? value : null
}

// ---------------------------------------------------------------- 记录

export interface ClaimRecord {
  status: 'pending' | 'ready'
  /** 这次结账的买家身份：付款事件的身份对得上，才把密钥交给这张领取码 */
  identity: string
  key?: string
  /** 第一次被读到密钥的时间（ISO 8601）；过了 CLAIM_REVEAL_WINDOW_MS 就不再给 */
  revealedAt?: string
}

export interface Device {
  deviceId: string
  deviceName: string
  /** 首次激活时间（ISO 8601）；同一设备重复激活不改它 */
  activatedAt: string
}

/** 许可证只有两种状态：有效，或因退款被吊销（吊销后不再回到有效） */
export type LicenseStatus = 'active' | 'revoked'

export interface LicenseRecord {
  identity: string
  orderId: string
  status: LicenseStatus
  /** 退款先于付款事件到达时，先记下一条没有密钥的吊销记录 */
  keyHash: string | null
  devices: Device[]
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
const invalidRequest = () => json({ error: 'invalid_request' }, 400)
const invalidLicense = () => json({ error: 'invalid_license' }, 404)
const revoked = () => json({ error: 'revoked' }, 403)

const allowed = (request: Request, env: Env, scope: keyof typeof LIMITS) =>
  withinRateLimit(env.LICENSES, clientIp(request), scope, LIMITS[scope])

/**
 * `POST /api/checkout` `{ email?, locale? }` → `{ url }`（前端跳转过去）。
 * 邮箱只用来预填收银台，可以不给（Waffo 收银台自己会收）；给了就必须像个邮箱。
 */
export async function handleCheckout(
  request: Request,
  env: Env,
  deps: BillingDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const config = waffoConfig(env)
  if (!config) return notConfigured()

  const body = await readBody(request)
  if (!body) return invalidRequest()
  const email = body.email === undefined || body.email === '' ? null : normalizeEmail(body.email)
  if (email === null && body.email !== undefined && body.email !== '') {
    return json({ error: 'invalid_email' }, 400)
  }
  const language =
    typeof body.locale === 'string'
      ? CASHIER_LANGUAGE[body.locale.toLowerCase() as keyof typeof CASHIER_LANGUAGE]
      : undefined
  if (!(await allowed(request, env, 'checkout'))) return rateLimited()

  const token = newClaimToken()
  const identity = newBuyerIdentity()
  const claim: ClaimRecord = { status: 'pending', identity }
  await env.LICENSES.put(claimKey(token), JSON.stringify(claim), {
    expirationTtl: CLAIM_TTL_SECONDS,
  })

  const successUrl = new URL('/activate', request.url)
  successUrl.searchParams.set('claim', token)
  try {
    const { checkoutUrl } = await (deps.client ?? sdkClient)(config).createCheckout({
      productId: config.productId,
      buyerIdentity: identity,
      // 只用来预填收银台的邮箱栏，不参与身份
      ...(email ? { buyerEmail: email } : {}),
      ...(language ? { language } : {}),
      successUrl: successUrl.toString(),
      metadata: { claim: token },
    })
    return json({ url: checkoutUrl })
  } catch {
    // 不把 SDK 的错误细节回给浏览器：里面可能有商户 ID、商品 ID
    return json({ error: 'checkout_failed' }, 502)
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
 * 按买家身份更新许可证。一次性商品只关心两种事件，守住三条规则：
 *
 * 1. `order.completed`（付款成功）签发许可证；同一身份已有许可证时不再生成第二把密钥。
 *    身份与领取码对得上，才把密钥交给领取码。
 * 2. `refund.succeeded` 吊销许可证（我们只做全额退款）。吊销是终态，晚到的付款事件改不回来；
 *    退款比付款先到时先记一条吊销记录，后到的付款事件因此不再签发。
 * 3. 比上次采纳的事件旧的一律忽略（重试与跨地域的 KV 读旧都会让事件乱序到达）。
 *
 * 订阅类事件（`subscription.*`）与其他事件一律忽略。
 */
export async function applyEvent(store: NotifyStore, event: BillingEvent, now: Date) {
  const isPayment = event.eventType === 'order.completed'
  const isRefund = event.eventType === 'refund.succeeded'
  if (!isPayment && !isRefund) return

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
  if (existing && Date.parse(event.timestamp) < Date.parse(existing.lastEventAt)) return

  const save = (record: LicenseRecord) =>
    store.put(licenseKey(identity), JSON.stringify(record satisfies LicenseRecord))

  if (isRefund) {
    if (existing && existing.orderId !== data.orderId) return
    await save({
      identity,
      orderId: data.orderId,
      status: 'revoked',
      keyHash: existing?.keyHash ?? null,
      devices: existing?.devices ?? [],
      mode: event.mode,
      lastEventAt: event.timestamp,
      updatedAt: now.toISOString(),
    })
    return
  }

  // 付款成功：已经有许可证（含已吊销的）就不再签发
  if (existing) return
  const key = newLicenseKey()
  const keyHash = await licenseKeyHash(key)
  await store.put(keyIndex(keyHash), identity)
  await save({
    identity,
    orderId: data.orderId,
    status: 'active',
    keyHash,
    devices: [],
    mode: event.mode,
    lastEventAt: event.timestamp,
    updatedAt: now.toISOString(),
  })
  if (claimToken && claim && claim.identity === identity) {
    const ready: ClaimRecord = { ...claim, status: 'ready', key }
    await store.put(claimKey(claimToken), JSON.stringify(ready), {
      expirationTtl: CLAIM_TTL_SECONDS,
    })
  }
}

/**
 * `GET /api/license/claim?claim=<领取码>` → `{ licenseKey }`；付款结果还没到时 `{ status: 'pending' }`。
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
  if (!claim) return json({ error: 'unknown_claim' }, 404)
  if (claim.status !== 'ready' || !claim.key) return json({ status: 'pending' })

  const now = (deps.now ?? (() => new Date()))()
  if (!claim.revealedAt) {
    // 第一次交出密钥后，领取码（含明文密钥）只再留一个可重复读的窗口，到期由 KV 删除
    const revealed: ClaimRecord = { ...claim, revealedAt: now.toISOString() }
    await env.LICENSES.put(claimKey(token), JSON.stringify(revealed), {
      expirationTtl: CLAIM_REVEAL_WINDOW_MS / 1000,
    })
  } else if (now.getTime() - Date.parse(claim.revealedAt) > CLAIM_REVEAL_WINDOW_MS) {
    return json({ error: 'unknown_claim' }, 404)
  }
  return json({ licenseKey: claim.key }, 200, { 'referrer-policy': 'no-referrer' })
}

/** 密钥 → 许可证。只认记录里当前那把密钥的哈希 */
async function findLicense(env: Env, rawKey: unknown): Promise<LicenseRecord | null> {
  const key = normalizeLicenseKey(rawKey)
  if (!key) return null
  const hash = await licenseKeyHash(key)
  const identity = await env.LICENSES.get(keyIndex(hash))
  const record = identity ? await readJson<LicenseRecord>(env.LICENSES, licenseKey(identity)) : null
  return record?.keyHash === hash ? { ...record, devices: record.devices ?? [] } : null
}

const saveLicense = (env: Env, record: LicenseRecord) =>
  env.LICENSES.put(licenseKey(record.identity), JSON.stringify(record))

/**
 * `POST /api/license/activate` `{ licenseKey, deviceId, deviceName }`：登记本机。
 * - 200 `{ status: 'active', devices, maxDevices }`；同一 deviceId 重复激活是幂等的（只更新设备名）。
 * - 409 `{ error: 'device_limit', devices, maxDevices }`：已满 3 台，客户端据此让用户选一台解绑。
 * - 404 `{ error: 'invalid_license' }`；403 `{ error: 'revoked' }`（已退款）。
 */
export async function handleActivate(
  request: Request,
  env: Env,
  deps: BillingDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readBody(request)
  const deviceId = normalizeDeviceId(body?.deviceId)
  const deviceName = cleanText(body?.deviceName, MAX_DEVICE_NAME_LENGTH)
  if (!body || !deviceId || !deviceName) return invalidRequest()
  if (!(await allowed(request, env, 'activate'))) return rateLimited()

  const license = await findLicense(env, body.licenseKey)
  if (!license) return invalidLicense()
  if (license.status !== 'active') return revoked()

  const now = (deps.now ?? (() => new Date()))()
  const known = license.devices.find((device) => device.deviceId === deviceId)
  if (!known && license.devices.length >= MAX_DEVICES) {
    return json({ error: 'device_limit', devices: license.devices, maxDevices: MAX_DEVICES }, 409)
  }
  const devices = known
    ? license.devices.map((device) =>
        device.deviceId === deviceId ? { ...device, deviceName } : device,
      )
    : [...license.devices, { deviceId, deviceName, activatedAt: now.toISOString() }]
  if (!known || known.deviceName !== deviceName) {
    await saveLicense(env, { ...license, devices, updatedAt: now.toISOString() })
  }
  return json({ status: 'active', devices, maxDevices: MAX_DEVICES })
}

/**
 * `POST /api/license/verify` `{ licenseKey, deviceId }` → 200 `{ status }`：
 * `active`（本机已激活）/ `revoked`（已退款）/ `not_activated`（密钥有效但本机不在列表里，
 * 例如在别的 Mac 上被解绑了）/ `invalid`（密钥不存在或格式不对）。客户端缓存结果，离线时按缓存走。
 */
export async function handleVerify(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readBody(request)
  const deviceId = normalizeDeviceId(body?.deviceId)
  if (!body || !deviceId) return invalidRequest()
  if (!(await allowed(request, env, 'verify'))) return rateLimited()

  const license = await findLicense(env, body.licenseKey)
  if (!license) return json({ status: 'invalid' })
  if (license.status !== 'active') return json({ status: 'revoked' })
  const activated = license.devices.some((device) => device.deviceId === deviceId)
  return json({ status: activated ? 'active' : 'not_activated' })
}

/**
 * `POST /api/license/deactivate` `{ licenseKey, deviceId }` → 200 `{ devices }`。
 * 凭密钥可以解绑任一设备（换机时旧 Mac 可能已经不在手边）；解绑不存在的设备也回 200（幂等）。
 * 已退款的许可证回 403 `{ error: 'revoked' }`，与激活一致。
 */
export async function handleDeactivate(
  request: Request,
  env: Env,
  deps: BillingDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readBody(request)
  const deviceId = normalizeDeviceId(body?.deviceId)
  if (!body || !deviceId) return invalidRequest()
  if (!(await allowed(request, env, 'deactivate'))) return rateLimited()

  const license = await findLicense(env, body.licenseKey)
  if (!license) return invalidLicense()
  if (license.status !== 'active') return revoked()

  const devices = license.devices.filter((device) => device.deviceId !== deviceId)
  if (devices.length !== license.devices.length) {
    const now = (deps.now ?? (() => new Date()))()
    await saveLicense(env, { ...license, devices, updatedAt: now.toISOString() })
  }
  return json({ devices })
}

/**
 * `POST /api/license/portal` `{ licenseKey }` → `{ url }`：Waffo 客户门户（查看发票、申请退款）。
 * 链接是一次性凭证，不缓存；身份取许可证里记下的，不信请求里带来的任何东西。
 */
export async function handlePortal(
  request: Request,
  env: Env,
  deps: BillingDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const config = waffoConfig(env)
  if (!config) return notConfigured()
  if (!(await allowed(request, env, 'portal'))) return rateLimited()
  const license = await findLicense(env, (await readBody(request))?.licenseKey)
  if (!license) return invalidLicense()
  try {
    const { portalUrl } = await (deps.client ?? sdkClient)(config).createPortalLink({
      storeId: config.storeId,
      buyerIdentity: license.identity,
    })
    return json({ url: portalUrl }, 200, { 'referrer-policy': 'no-referrer' })
  } catch {
    return json({ error: 'portal_failed' }, 502)
  }
}
