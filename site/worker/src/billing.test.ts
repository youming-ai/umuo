import { describe, expect, it } from 'vitest'
import {
  type BillingDeps,
  type BillingEvent,
  type ClaimRecord,
  handleActivate,
  handleCheckout,
  handleClaim,
  handleDeactivate,
  handlePortal,
  handleVerify,
  handleWebhook,
  type LicenseRecord,
  licenseKeyHash,
  MAX_DEVICES,
  newBuyerIdentity,
  newLicenseKey,
  normalizeLicenseKey,
  type WaffoClient,
  waffoConfig,
} from './billing'
import type { Env, NotifyStore } from './env'

/** 假 KV：与 notify.test.ts 同一个做法，只实现两个方法 */
function fakeStore() {
  const entries = new Map<string, string>()
  const store: NotifyStore = {
    async get(key) {
      return entries.get(key) ?? null
    },
    async put(key, value) {
      entries.set(key, value)
    },
  }
  return { store, entries }
}

const STORE_ID = 'STO_3x7Kp9QwZr2Lm8NvB4tYcd'
const CONFIGURED = {
  WAFFO_ENV: 'test',
  WAFFO_MERCHANT_ID: 'MER_3x7Kp9QwZr2Lm8NvB4tYcd',
  WAFFO_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
  WAFFO_STORE_ID: STORE_ID,
  WAFFO_PRODUCT_LICENSE: 'PROD_license',
}

function makeEnv(store: NotifyStore, waffo: Partial<Env> = CONFIGURED): Env {
  return {
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    NOTIFY_KV: { get: async () => null, put: async () => {} },
    RELEASES: { get: async () => null },
    LICENSES: store,
    ...waffo,
  }
}

/** 假 Waffo：记下收到的参数，返回固定链接；不打网络 */
function fakeClient() {
  const calls: { checkout: Array<Record<string, unknown>>; portal: unknown[] } = {
    checkout: [],
    portal: [],
  }
  const client: WaffoClient = {
    async createCheckout(params) {
      calls.checkout.push(params)
      return { checkoutUrl: 'https://pancake.waffo.ai/checkout#token=t' }
    },
    async createPortalLink(params) {
      calls.portal.push(params)
      return { portalUrl: 'https://pancake.waffo.ai/consumer/portal/store/STO_x#token=p' }
    },
  }
  return { deps: { client: () => client } satisfies BillingDeps, calls }
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://umuo.app${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

/**
 * 按 Waffo 文档的形状造事件：一次性商品付款成功是 `order.completed`（eventId 是付款号、
 * orderStatus 为 completed），退款是 `refund.succeeded`（eventId 是退款号）。
 * 实际投递里顶层 `id` 可能就是订单号，所以同一订单的两个事件 `id` 相同——不能只按 id 去重。
 */
let clock = Date.parse('2026-10-19T00:00:00Z')
function event(
  eventType: string,
  data: Partial<BillingEvent['data']>,
  extra: Partial<BillingEvent> = {},
): BillingEvent {
  const orderId = data.orderId ?? 'ORD_1'
  clock += 60_000
  return {
    id: orderId,
    eventId: eventType === 'refund.succeeded' ? `REF_${clock}` : `PAY_${clock}`,
    eventType,
    timestamp: new Date(clock).toISOString(),
    mode: 'test',
    storeId: STORE_ID,
    ...extra,
    data: { orderId, ...data },
  }
}

/** 假验签：签名必须是 "ok"，事件由 body 直接给出 */
const verifyDeps: BillingDeps = {
  verify(body, signature) {
    if (signature !== 'ok') throw new Error('bad signature')
    return JSON.parse(body) as BillingEvent
  },
  now: () => new Date('2026-10-19T00:00:00Z'),
}

const webhook = (store: NotifyStore, e: BillingEvent, signature = 'ok') =>
  handleWebhook(
    post('/api/waffo/webhook', e, { 'x-waffo-signature': signature }),
    makeEnv(store),
    verifyDeps,
  )

const claimRequest = (token: string) =>
  new Request(`https://umuo.app/api/license/claim?claim=${token}`, {
    headers: { 'cf-connecting-ip': '203.0.113.7' },
  })

/** 走一遍结账，返回领取码与这次结账的身份 */
async function checkout(store: NotifyStore) {
  const { deps, calls } = fakeClient()
  await handleCheckout(
    post('/api/checkout', { email: 'ada@example.com', locale: 'en' }),
    makeEnv(store),
    deps,
  )
  const params = calls.checkout[0] as { buyerIdentity: string; metadata: Record<string, string> }
  return { token: params.metadata.claim as string, identity: params.buyerIdentity }
}

const paid = (identity: string, token: string, orderId = 'ORD_1') =>
  event('order.completed', {
    orderId,
    orderStatus: 'completed',
    merchantProvidedBuyerIdentity: identity,
    orderMetadata: { claim: token },
  })

/** 结账 + 付款成功，返回密钥 */
async function purchase(store: NotifyStore, entries: Map<string, string>) {
  const { token, identity } = await checkout(store)
  await webhook(store, paid(identity, token))
  const key = (JSON.parse(entries.get(`claim:${token}`) ?? '') as ClaimRecord).key as string
  return { token, identity, key }
}

const call = async (
  handler: (request: Request, env: Env, deps?: BillingDeps) => Promise<Response>,
  path: string,
  store: NotifyStore,
  body: unknown,
) => {
  const response = await handler(post(path, body), makeEnv(store), { now: verifyDeps.now })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}
const activate = (store: NotifyStore, licenseKey: string, deviceId: string, deviceName = 'Mac') =>
  call(handleActivate, '/api/license/activate', store, { licenseKey, deviceId, deviceName })
const verify = (store: NotifyStore, licenseKey: string, deviceId: string) =>
  call(handleVerify, '/api/license/verify', store, { licenseKey, deviceId })
const deactivate = (store: NotifyStore, licenseKey: string, deviceId: string) =>
  call(handleDeactivate, '/api/license/deactivate', store, { licenseKey, deviceId })

describe('waffoConfig', () => {
  it('缺任何一项都不算配好——宁可 503，也不带着半套配置去收钱', () => {
    const store = fakeStore().store
    expect(waffoConfig(makeEnv(store, {}))).toBeNull()
    expect(waffoConfig(makeEnv(store, { ...CONFIGURED, WAFFO_PRIVATE_KEY: '' }))).toBeNull()
    expect(waffoConfig(makeEnv(store, { ...CONFIGURED, WAFFO_PRODUCT_LICENSE: '' }))).toBeNull()
    expect(waffoConfig(makeEnv(store, { ...CONFIGURED, WAFFO_ENV: 'staging' }))).toBeNull()
  })

  it('配齐时给出买断商品 ID', () => {
    expect(waffoConfig(makeEnv(fakeStore().store))?.productId).toBe('PROD_license')
  })
})

describe('身份与密钥', () => {
  it('密钥格式固定、可以原样校验回来；粘贴时的空白与小写不影响', () => {
    const key = newLicenseKey()
    expect(key).toMatch(/^UMUO(-[0-9A-Z]{5}){4}$/)
    expect(normalizeLicenseKey(`  ${key.toLowerCase()}\n`)).toBe(key)
  })

  it('不认含 I / L / O / U 的串——这些字符不在字母表里，多半是抄错了', () => {
    expect(normalizeLicenseKey('UMUO-IIIII-00000-00000-00000')).toBeNull()
    expect(normalizeLicenseKey(42)).toBeNull()
  })

  it('每次结账的买家身份都是随机的，同一个邮箱也不相同（防止凭邮箱冒领他人的会话）', async () => {
    const { store } = fakeStore()
    const { deps, calls } = fakeClient()
    const body = { email: 'ada@example.com', locale: 'en' }
    await handleCheckout(post('/api/checkout', body), makeEnv(store), deps)
    await handleCheckout(post('/api/checkout', body), makeEnv(store), deps)
    const [first, second] = calls.checkout.map((params) => params.buyerIdentity)
    expect(first).not.toBe(second)
    expect(newBuyerIdentity()).toMatch(/^u_[\w-]{24}$/)
  })
})

describe('POST /api/checkout', () => {
  it('没配 Waffo（含正式环境还没建买断商品）时回 503', async () => {
    const { WAFFO_PRODUCT_LICENSE: _, ...withoutProduct } = CONFIGURED
    for (const waffo of [{}, withoutProduct]) {
      const response = await handleCheckout(
        post('/api/checkout', { email: 'ada@example.com', locale: 'en' }),
        makeEnv(fakeStore().store, waffo),
      )
      expect(response.status).toBe(503)
    }
  })

  it('请求体不是 JSON 对象、或给了不像邮箱的邮箱时回 400，不碰 Waffo', async () => {
    const { store } = fakeStore()
    const { deps, calls } = fakeClient()
    const env = makeEnv(store)
    for (const body of ['nope', { email: 'x' }, { email: 42 }]) {
      expect((await handleCheckout(post('/api/checkout', body), env, deps)).status).toBe(400)
    }
    expect(calls.checkout).toHaveLength(0)
  })

  it('返回 { url }；领取码记下这次的身份，付完跳回 /activate；邮箱只用来预填，语言映射到收银台', async () => {
    const { store, entries } = fakeStore()
    const { deps, calls } = fakeClient()
    const response = await handleCheckout(
      post('/api/checkout', { email: ' Ada@Example.com ', locale: 'zh-tw' }),
      makeEnv(store),
      deps,
    )
    expect(await response.json()).toEqual({ url: 'https://pancake.waffo.ai/checkout#token=t' })
    const params = calls.checkout[0] as Record<string, unknown>
    const token = (params.metadata as Record<string, string>).claim
    expect(params).toEqual({
      productId: 'PROD_license',
      buyerIdentity: expect.stringMatching(/^u_/),
      buyerEmail: 'ada@example.com',
      language: 'zh-Hant-TW',
      successUrl: `https://umuo.app/activate?claim=${token}`,
      metadata: { claim: token },
    })
    expect(JSON.parse(entries.get(`claim:${token}`) ?? '')).toEqual({
      status: 'pending',
      identity: params.buyerIdentity,
    })
  })

  it('邮箱可以不给（收银台自己会收），未知语言就交给 Waffo 自己推断', async () => {
    const { deps, calls } = fakeClient()
    const response = await handleCheckout(
      post('/api/checkout', { locale: 'fr' }),
      makeEnv(fakeStore().store),
      deps,
    )
    expect(response.status).toBe(200)
    expect(calls.checkout[0]).not.toHaveProperty('buyerEmail')
    expect(calls.checkout[0]).not.toHaveProperty('language')
  })

  it('Waffo 出错时回 502，不把错误细节交给浏览器', async () => {
    const deps: BillingDeps = {
      client: () => ({
        createCheckout: async () => {
          throw new Error('MER_secret PROD_secret')
        },
        createPortalLink: async () => ({ portalUrl: '' }),
      }),
    }
    const response = await handleCheckout(
      post('/api/checkout', { email: 'ada@example.com' }),
      makeEnv(fakeStore().store),
      deps,
    )
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('secret')
  })
})

describe('POST /api/waffo/webhook', () => {
  it('签名不对回 401，什么都不写', async () => {
    const { store, entries } = fakeStore()
    expect((await webhook(store, paid('u_x', 'c'), 'bad')).status).toBe(401)
    expect(entries.size).toBe(0)
  })

  it('别的店铺的事件（签名同样合法：密钥是平台级的）直接忽略，抢不走领取码', async () => {
    const { store, entries } = fakeStore()
    const { token } = await checkout(store)
    const foreign = { ...paid('u_attacker', token), storeId: 'STO_someoneElse0000000000' }
    expect(await (await webhook(store, foreign)).json()).toMatchObject({ ignored: 'store' })
    expect(JSON.parse(entries.get(`claim:${token}`) ?? '').status).toBe('pending')
  })

  it('本店铺的事件，身份对不上领取码时也不交出密钥', async () => {
    const { store, entries } = fakeStore()
    const { token } = await checkout(store)
    await webhook(store, paid('u_someoneElse', token))
    expect(JSON.parse(entries.get(`claim:${token}`) ?? '').status).toBe('pending')
  })

  it('另一个环境的事件直接忽略', async () => {
    const { store, entries } = fakeStore()
    await webhook(store, { ...paid('u_x', 'c'), mode: 'prod' })
    expect(entries.size).toBe(0)
  })

  it('付款成功：签发许可证、挂到领取码上；KV 里只有密钥的哈希', async () => {
    const { store, entries } = fakeStore()
    const { identity, key } = await purchase(store, entries)
    expect(normalizeLicenseKey(key)).toBe(key)
    expect(entries.get(`key:${await licenseKeyHash(key)}`)).toBe(identity)
    const record = JSON.parse(entries.get(`lic:${identity}`) ?? '') as LicenseRecord
    expect(record).toMatchObject({ status: 'active', orderId: 'ORD_1', devices: [] })
    expect(entries.get(`lic:${identity}`)).not.toContain(key)
  })

  it('同一事件重试时不再处理（不会生成第二把密钥）', async () => {
    const { store, entries } = fakeStore()
    const { token, identity } = await checkout(store)
    const completed = paid(identity, token)
    await webhook(store, completed)
    const first = entries.get(`claim:${token}`)
    expect(await (await webhook(store, completed)).json()).toMatchObject({ duplicate: true })
    expect(entries.get(`claim:${token}`)).toBe(first)
  })

  it('同一订单再来一条不同 eventId 的付款事件，也不会换掉已发出的密钥', async () => {
    const { store, entries } = fakeStore()
    const { token, identity, key } = await purchase(store, entries)
    await webhook(store, paid(identity, token))
    expect((JSON.parse(entries.get(`claim:${token}`) ?? '') as ClaimRecord).key).toBe(key)
    expect((await activate(store, key, 'mac-1')).status).toBe(200)
  })

  it('退款吊销许可证：激活回 403，校验回 revoked；晚到的旧付款事件改不回来', async () => {
    const { store, entries } = fakeStore()
    const { token, identity } = await checkout(store)
    // 先造出一个时间更早的付款事件，再让它在退款之后重投
    const completed = paid(identity, token)
    await webhook(store, completed)
    const key = (JSON.parse(entries.get(`claim:${token}`) ?? '') as ClaimRecord).key as string
    await activate(store, key, 'mac-1')
    await webhook(
      store,
      event('refund.succeeded', {
        orderStatus: 'completed',
        merchantProvidedBuyerIdentity: identity,
      }),
    )
    await webhook(store, { ...completed, eventId: 'PAY_retry' })
    expect(await activate(store, key, 'mac-2')).toEqual({ status: 403, body: { error: 'revoked' } })
    expect((await verify(store, key, 'mac-1')).body).toEqual({ status: 'revoked' })
    expect(await deactivate(store, key, 'mac-1')).toEqual({
      status: 403,
      body: { error: 'revoked' },
    })
  })

  it('退款事件不带身份时按订单号找到许可证', async () => {
    const { store, entries } = fakeStore()
    const { key } = await purchase(store, entries)
    await webhook(store, event('refund.succeeded', {}))
    expect((await verify(store, key, 'mac-1')).body).toEqual({ status: 'revoked' })
  })

  it('退款比付款先到：先记吊销，后到的付款事件不再签发密钥', async () => {
    const { store, entries } = fakeStore()
    const { token, identity } = await checkout(store)
    const completed = paid(identity, token)
    await webhook(store, event('refund.succeeded', { merchantProvidedBuyerIdentity: identity }))
    await webhook(store, completed)
    expect(JSON.parse(entries.get(`claim:${token}`) ?? '').status).toBe('pending')
    expect(JSON.parse(entries.get(`lic:${identity}`) ?? '').status).toBe('revoked')
  })

  it('订阅类事件与找不到身份的订单都不碰', async () => {
    const { store, entries } = fakeStore()
    const { token, identity } = await checkout(store)
    await webhook(
      store,
      event('subscription.activated', {
        orderStatus: 'active',
        merchantProvidedBuyerIdentity: identity,
        orderMetadata: { claim: token },
      }),
    )
    await webhook(store, event('order.completed', { orderId: 'ORD_unknown' }))
    expect([...entries.keys()].some((key) => key.startsWith('lic:'))).toBe(false)
  })
})

describe('GET /api/license/claim', () => {
  it('首次领到后 1 小时内可重复读（刷新页面），之后失效', async () => {
    const { store, entries } = fakeStore()
    const { token, key } = await purchase(store, entries)
    const read = (now: string) =>
      handleClaim(claimRequest(token), makeEnv(store), { now: () => new Date(now) })
    expect(await (await read('2026-10-19T00:00:00Z')).json()).toEqual({ licenseKey: key })
    expect(await (await read('2026-10-19T00:59:00Z')).json()).toEqual({ licenseKey: key })
    const expired = await read('2026-10-19T01:01:00Z')
    expect(expired.status).toBe(404)
    expect(await expired.json()).toEqual({ error: 'unknown_claim' })
  })

  it('付款前是 pending，未知的回 404', async () => {
    const { store, entries } = fakeStore()
    entries.set('claim:waiting', JSON.stringify({ status: 'pending', identity: 'u_x' }))
    const env = makeEnv(store)
    expect(await (await handleClaim(claimRequest('waiting'), env)).json()).toEqual({
      status: 'pending',
    })
    expect((await handleClaim(claimRequest('nope'), env)).status).toBe(404)
  })
})

describe('激活、校验与解绑', () => {
  it(`激活到第 ${MAX_DEVICES} 台都成功，第 4 台回 409 并带上已激活的设备`, async () => {
    const { store, entries } = fakeStore()
    const { key } = await purchase(store, entries)
    for (const [index, id] of ['mac-1', 'mac-2', 'mac-3'].entries()) {
      const result = await activate(store, key, id, `Mac ${index + 1}`)
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ status: 'active', maxDevices: 3 })
      expect(result.body.devices).toHaveLength(index + 1)
    }
    const full = await activate(store, key, 'mac-4')
    expect(full.status).toBe(409)
    expect(full.body).toEqual({
      error: 'device_limit',
      maxDevices: 3,
      devices: ['mac-1', 'mac-2', 'mac-3'].map((deviceId, index) => ({
        deviceId,
        deviceName: `Mac ${index + 1}`,
        activatedAt: '2026-10-19T00:00:00.000Z',
      })),
    })
  })

  it('同一 deviceId 重复激活是幂等的：不占新名额，激活时间不变，设备名随之更新', async () => {
    const { store, entries } = fakeStore()
    const { key } = await purchase(store, entries)
    await activate(store, key, 'mac-1', 'Old name')
    await activate(store, key, 'mac-2')
    await activate(store, key, 'mac-3')
    const again = await activate(store, key, 'mac-1', 'New name')
    expect(again.status).toBe(200)
    expect(again.body.devices).toHaveLength(3)
    expect((again.body.devices as Array<Record<string, string>>)[0]).toEqual({
      deviceId: 'mac-1',
      deviceName: 'New name',
      activatedAt: '2026-10-19T00:00:00.000Z',
    })
  })

  it('解绑任一设备后腾出名额，新设备可以激活；解绑不存在的设备也回 200', async () => {
    const { store, entries } = fakeStore()
    const { key } = await purchase(store, entries)
    for (const id of ['mac-1', 'mac-2', 'mac-3']) await activate(store, key, id)
    const removed = await deactivate(store, key, 'mac-2')
    expect(removed.status).toBe(200)
    expect((removed.body.devices as Array<{ deviceId: string }>).map((d) => d.deviceId)).toEqual([
      'mac-1',
      'mac-3',
    ])
    expect((await verify(store, key, 'mac-2')).body).toEqual({ status: 'not_activated' })
    expect((await activate(store, key, 'mac-4')).status).toBe(200)
    expect((await deactivate(store, key, 'gone')).status).toBe(200)
  })

  it('verify 的四种状态：active / not_activated / revoked / invalid，都是 200', async () => {
    const { store, entries } = fakeStore()
    const { identity, key } = await purchase(store, entries)
    await activate(store, key, 'mac-1')
    expect(await verify(store, key, 'mac-1')).toEqual({ status: 200, body: { status: 'active' } })
    expect(await verify(store, key.toLowerCase(), 'mac-1')).toEqual({
      status: 200,
      body: { status: 'active' },
    })
    expect(await verify(store, key, 'mac-9')).toEqual({
      status: 200,
      body: { status: 'not_activated' },
    })
    for (const bad of [newLicenseKey(), 'x', undefined]) {
      expect(await verify(store, bad as string, 'mac-1')).toEqual({
        status: 200,
        body: { status: 'invalid' },
      })
    }
    await webhook(store, event('refund.succeeded', { merchantProvidedBuyerIdentity: identity }))
    expect(await verify(store, key, 'mac-1')).toEqual({ status: 200, body: { status: 'revoked' } })
  })

  it('无效密钥：激活与解绑回 404 invalid_license', async () => {
    const { store } = fakeStore()
    for (const key of [newLicenseKey(), 'x']) {
      expect(await activate(store, key, 'mac-1')).toEqual({
        status: 404,
        body: { error: 'invalid_license' },
      })
      expect(await deactivate(store, key, 'mac-1')).toEqual({
        status: 404,
        body: { error: 'invalid_license' },
      })
    }
  })

  it('缺 deviceId / deviceName 回 400；设备名去掉控制字符并截断，超长的 deviceId 拒绝', async () => {
    const { store, entries } = fakeStore()
    const { key } = await purchase(store, entries)
    const bad = [
      { licenseKey: key, deviceName: 'Mac' },
      { licenseKey: key, deviceId: 'mac-1' },
      { licenseKey: key, deviceId: 'mac-1', deviceName: '\u0000​' },
      { licenseKey: key, deviceId: 'x'.repeat(129), deviceName: 'Mac' },
    ]
    for (const body of bad) {
      expect((await call(handleActivate, '/api/license/activate', store, body)).status).toBe(400)
    }
    expect(
      (await call(handleVerify, '/api/license/verify', store, { licenseKey: key })).status,
    ).toBe(400)
    const ok = await activate(store, key, 'mac-1', `Ada\n的 MacBook${'!'.repeat(100)}`)
    const [device] = ok.body.devices as Array<{ deviceName: string }>
    expect(device?.deviceName).toMatch(/^Ada的 MacBook!+$/)
    expect(device?.deviceName.length).toBe(64)
  })

  it('校验：同一网络下的多台客户端不会很快被限流', async () => {
    const { store, entries } = fakeStore()
    const { key } = await purchase(store, entries)
    await activate(store, key, 'mac-1')
    for (let i = 0; i < 20; i++) expect((await verify(store, key, 'mac-1')).status).toBe(200)
  })

  it('激活被同一 IP 刷太多次时回 429', async () => {
    const { store, entries } = fakeStore()
    const { key } = await purchase(store, entries)
    const statuses: number[] = []
    for (let i = 0; i < 25; i++) statuses.push((await activate(store, key, 'mac-1')).status)
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
  })
})

describe('POST /api/license/portal', () => {
  it('用许可证里记下的身份换链接，而不是请求里带来的任何东西', async () => {
    const { store, entries } = fakeStore()
    const { identity, key } = await purchase(store, entries)
    const { deps, calls } = fakeClient()
    const response = await handlePortal(
      post('/api/license/portal', { licenseKey: key, buyerIdentity: 'u_attacker' }),
      makeEnv(store),
      deps,
    )
    expect(await response.json()).toEqual({
      url: expect.stringContaining('#token='),
    })
    expect(calls.portal[0]).toEqual({ storeId: STORE_ID, buyerIdentity: identity })
  })

  it('未知密钥回 404', async () => {
    const { deps } = fakeClient()
    const response = await handlePortal(
      post('/api/license/portal', { licenseKey: newLicenseKey() }),
      makeEnv(fakeStore().store),
      deps,
    )
    expect(response.status).toBe(404)
  })
})
