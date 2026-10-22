import { describe, expect, it } from 'vitest'
import {
  type BillingDeps,
  type BillingEvent,
  type ClaimRecord,
  handleCheckout,
  handleClaim,
  handlePortal,
  handleVerify,
  handleWebhook,
  isEntitled,
  type LicenseRecord,
  licenseKeyHash,
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
  WAFFO_PRODUCT_PREMIUM_MONTHLY: 'PROD_monthly',
  WAFFO_PRODUCT_PREMIUM_YEARLY: 'PROD_yearly',
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

/** 假 Waffo：记下收到的参数，返回固定链接 */
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
 * 按 Waffo 文档的真实形状造事件：订阅类事件的顶层 `id` 与 `eventId` 都是**订单号**
 * （renewed / canceling 等的 eventId 另带后缀），所以同一订单的不同事件 `id` 相同。
 * 旧测试给每个事件不同的 id，正好掩盖了「按 id 去重会吞掉后续事件」这个 bug。
 */
let clock = Date.parse('2026-10-19T00:00:00Z')
function event(
  eventType: string,
  data: Partial<BillingEvent['data']>,
  extra: Partial<BillingEvent> = {},
): BillingEvent {
  const orderId = data.orderId ?? 'ORD_1'
  clock += 60_000
  const suffix =
    eventType === 'subscription.renewed'
      ? `-renewed-${data.currentPeriodEnd}`
      : ['subscription.canceling', 'subscription.uncanceled', 'subscription.past_due'].includes(
            eventType,
          )
        ? `-${new Date(clock).toISOString()}`
        : ''
  return {
    id: orderId,
    eventId: `${orderId}${suffix}`,
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
async function checkout(store: NotifyStore, plan = 'premium-monthly') {
  const { deps, calls } = fakeClient()
  await handleCheckout(
    post('/api/checkout', { plan, email: 'ada@example.com' }),
    makeEnv(store),
    deps,
  )
  const params = calls.checkout[0] as { buyerIdentity: string; metadata: Record<string, string> }
  return { token: params.metadata.claim as string, identity: params.buyerIdentity }
}

/** 结账 + 激活，返回密钥 */
async function activate(store: NotifyStore, entries: Map<string, string>) {
  const { token, identity } = await checkout(store)
  await webhook(
    store,
    event('subscription.activated', {
      orderStatus: 'active',
      merchantProvidedBuyerIdentity: identity,
      orderMetadata: { claim: token },
      billingPeriod: 'monthly',
      currentPeriodEnd: '2026-10-20',
    }),
  )
  const key = (JSON.parse(entries.get(`claim:${token}`) ?? '') as ClaimRecord).key as string
  return { token, identity, key }
}

async function verify(store: NotifyStore, key: string, now = '2026-10-19T00:00:00Z') {
  const response = await handleVerify(post('/api/license/verify', { key }), makeEnv(store), {
    now: () => new Date(now),
  })
  return (await response.json()) as Record<string, unknown>
}

describe('waffoConfig', () => {
  it('缺任何一项都不算配好——宁可 503，也不带着半套配置去收钱', () => {
    const store = fakeStore().store
    expect(waffoConfig(makeEnv(store, {}))).toBeNull()
    expect(waffoConfig(makeEnv(store, { ...CONFIGURED, WAFFO_PRIVATE_KEY: '' }))).toBeNull()
    expect(waffoConfig(makeEnv(store, { ...CONFIGURED, WAFFO_ENV: 'staging' }))).toBeNull()
  })

  it('配齐时按套餐给出商品 ID', () => {
    expect(waffoConfig(makeEnv(fakeStore().store))?.products['premium-yearly']).toBe('PROD_yearly')
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
    const body = { plan: 'premium-monthly', email: 'ada@example.com' }
    await handleCheckout(post('/api/checkout', body), makeEnv(store), deps)
    await handleCheckout(post('/api/checkout', body), makeEnv(store), deps)
    const [first, second] = calls.checkout.map((params) => params.buyerIdentity)
    expect(first).not.toBe(second)
    expect(newBuyerIdentity()).toMatch(/^u_[\w-]{24}$/)
  })
})

describe('isEntitled', () => {
  const base: LicenseRecord = {
    identity: 'u_x',
    orderId: 'ORD_1',
    plan: 'premium-monthly',
    status: 'active',
    currentPeriodEnd: '2026-10-31',
    keyHash: 'h',
    mode: 'test',
    lastEventAt: '',
    updatedAt: '',
  }
  const at = (iso: string) => new Date(iso)

  it('active / canceling / past_due 在账期内都算有效；canceled / refunded 立即失效', () => {
    for (const status of ['active', 'canceling', 'past_due']) {
      expect(isEntitled({ ...base, status }, at('2026-10-20T00:00:00Z'))).toBe(true)
    }
    for (const status of ['canceled', 'refunded']) {
      expect(isEntitled({ ...base, status }, at('2026-10-20T00:00:00Z'))).toBe(false)
    }
  })

  it('只有日期的账期按当天结束算，再给 3 天宽限', () => {
    expect(isEntitled(base, at('2026-11-03T23:00:00Z'))).toBe(true)
    expect(isEntitled(base, at('2026-11-04T00:00:01Z'))).toBe(false)
  })
})

describe('POST /api/checkout', () => {
  it('没配 Waffo 时回 503', async () => {
    const response = await handleCheckout(
      post('/api/checkout', { plan: 'premium-monthly', email: 'ada@example.com' }),
      makeEnv(fakeStore().store, {}),
    )
    expect(response.status).toBe(503)
  })

  it('套餐或邮箱不合法时回 400，不碰 Waffo', async () => {
    const { store } = fakeStore()
    const { deps, calls } = fakeClient()
    const env = makeEnv(store)
    const bad = [
      { plan: 'pro', email: 'a@b.com' },
      { plan: 'premium-monthly', email: 'x' },
    ]
    for (const body of bad) {
      expect((await handleCheckout(post('/api/checkout', body), env, deps)).status).toBe(400)
    }
    expect(calls.checkout).toHaveLength(0)
  })

  it('领取码记下套餐与这次的身份，付完跳回 /activate；邮箱只用来预填', async () => {
    const { store, entries } = fakeStore()
    const { deps, calls } = fakeClient()
    const response = await handleCheckout(
      post('/api/checkout', { plan: 'premium-yearly', email: ' Ada@Example.com ' }),
      makeEnv(store),
      deps,
    )
    expect(await response.json()).toMatchObject({
      ok: true,
      checkoutUrl: expect.stringContaining('waffo'),
    })
    const params = calls.checkout[0] as Record<string, unknown>
    const token = (params.metadata as Record<string, string>).claim
    expect(params).toMatchObject({
      productId: 'PROD_yearly',
      buyerEmail: 'ada@example.com',
      successUrl: `https://umuo.app/activate?claim=${token}`,
    })
    expect(JSON.parse(entries.get(`claim:${token}`) ?? '')).toEqual({
      status: 'pending',
      plan: 'premium-yearly',
      identity: params.buyerIdentity,
    })
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
      post('/api/checkout', { plan: 'premium-monthly', email: 'ada@example.com' }),
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
    const activated = event('subscription.activated', { orderStatus: 'active' })
    expect((await webhook(store, activated, 'bad')).status).toBe(401)
    expect(entries.size).toBe(0)
  })

  it('别的店铺的事件（签名同样合法：密钥是平台级的）直接忽略，抢不走领取码', async () => {
    const { store, entries } = fakeStore()
    const { token } = await checkout(store)
    const foreign = event(
      'subscription.activated',
      {
        orderStatus: 'active',
        merchantProvidedBuyerIdentity: 'u_attacker',
        orderMetadata: { claim: token },
        currentPeriodEnd: '2099-01-01',
      },
      { storeId: 'STO_someoneElse0000000000' },
    )
    expect(await (await webhook(store, foreign)).json()).toMatchObject({ ignored: 'store' })
    expect(JSON.parse(entries.get(`claim:${token}`) ?? '').status).toBe('pending')
  })

  it('本店铺的事件，身份对不上领取码时也不交出密钥', async () => {
    const { store, entries } = fakeStore()
    const { token } = await checkout(store)
    await webhook(
      store,
      event('subscription.activated', {
        orderStatus: 'active',
        merchantProvidedBuyerIdentity: 'u_someoneElse',
        orderMetadata: { claim: token },
      }),
    )
    expect(JSON.parse(entries.get(`claim:${token}`) ?? '').status).toBe('pending')
  })

  it('另一个环境的事件直接忽略', async () => {
    const { store, entries } = fakeStore()
    const prod = event('subscription.activated', { orderStatus: 'active' }, { mode: 'prod' })
    await webhook(store, prod)
    expect(entries.size).toBe(0)
  })

  it('首次激活时生成密钥、挂到领取码上；KV 里只有密钥的哈希', async () => {
    const { store, entries } = fakeStore()
    const { identity, key } = await activate(store, entries)
    expect(entries.get(`key:${await licenseKeyHash(key)}`)).toBe(identity)
    expect(entries.get(`lic:${identity}`)).not.toContain(key)
    expect(await verify(store, key)).toMatchObject({
      ok: true,
      entitled: true,
      plan: 'premium-monthly',
    })
  })

  it('同一事件重试时不再处理（不会生成第二把密钥）', async () => {
    const { store, entries } = fakeStore()
    const { token, identity } = await checkout(store)
    const activated = event('subscription.activated', {
      orderStatus: 'active',
      merchantProvidedBuyerIdentity: identity,
      orderMetadata: { claim: token },
    })
    await webhook(store, activated)
    const first = entries.get(`claim:${token}`)
    expect(await (await webhook(store, activated)).json()).toMatchObject({ duplicate: true })
    expect(entries.get(`claim:${token}`)).toBe(first)
  })

  it('激活后紧接着的续费不会被当成重复丢掉（同一订单的事件 id 相同）', async () => {
    const { store, entries } = fakeStore()
    const { identity, key } = await activate(store, entries)
    await webhook(
      store,
      event('subscription.renewed', {
        orderStatus: 'active',
        merchantProvidedBuyerIdentity: identity,
        currentPeriodEnd: '2026-11-20',
      }),
    )
    // 试用期到 10-20，加 3 天宽限也早过了；续费把账期延到 11-20，所以仍然有效
    expect(await verify(store, key, '2026-11-01T00:00:00Z')).toMatchObject({
      entitled: true,
      currentPeriodEnd: '2026-11-20',
    })
  })

  it('取消后校验返回失效，晚到的旧「生效」事件改不回来', async () => {
    const { store, entries } = fakeStore()
    const { identity, key } = await activate(store, entries)
    // 先造出一个时间更早的事件，再让它晚到
    const stale = event('subscription.uncanceled', {
      orderStatus: 'active',
      merchantProvidedBuyerIdentity: identity,
    })
    const canceled = event('subscription.canceled', {
      orderStatus: 'canceled',
      merchantProvidedBuyerIdentity: identity,
    })
    await webhook(store, canceled)
    await webhook(store, stale)
    expect(await verify(store, key)).toMatchObject({ entitled: false, status: 'canceled' })
  })

  it('换套餐（新订单号）后密钥跟着走，套餐名也更新；旧订单之后的事件不再影响', async () => {
    const { store, entries } = fakeStore()
    const { identity, key } = await activate(store, entries)
    await webhook(
      store,
      event('subscription.plan_change_scheduled', {
        orderId: 'ORD_2',
        orderStatus: 'pending',
        merchantProvidedBuyerIdentity: identity,
      }),
    )
    expect(await verify(store, key)).toMatchObject({ entitled: true, plan: 'premium-monthly' })
    await webhook(
      store,
      event('subscription.plan_changed', {
        orderId: 'ORD_2',
        orderStatus: 'active',
        merchantProvidedBuyerIdentity: identity,
        billingPeriod: 'yearly',
        currentPeriodEnd: '2027-10-20',
      }),
    )
    await webhook(
      store,
      event('subscription.canceled', {
        orderId: 'ORD_1',
        orderStatus: 'canceled',
        merchantProvidedBuyerIdentity: identity,
      }),
    )
    expect(await verify(store, key, '2027-01-01T00:00:00Z')).toMatchObject({
      entitled: true,
      plan: 'premium-yearly',
      currentPeriodEnd: '2027-10-20',
    })
  })

  it('全额退款收回 Premium', async () => {
    const { store, entries } = fakeStore()
    const { identity, key } = await activate(store, entries)
    const refund = event(
      'refund.succeeded',
      { merchantProvidedBuyerIdentity: identity },
      { eventId: 'REF_1' },
    )
    await webhook(store, refund)
    expect(await verify(store, key)).toMatchObject({ entitled: false, status: 'refunded' })
  })

  it('纯支付事件（没有 orderStatus）不改许可证；找不到身份的订单不碰', async () => {
    const { store, entries } = fakeStore()
    await webhook(store, event('subscription.payment_succeeded', {}))
    await webhook(store, event('subscription.activated', { orderStatus: 'active' }))
    expect([...entries.keys()].some((key) => key.startsWith('lic:'))).toBe(false)
  })
})

describe('领取、校验与门户', () => {
  it('领取码：首次领到后 1 小时内可重复读（刷新页面），之后失效', async () => {
    const { store, entries } = fakeStore()
    const { token, key } = await activate(store, entries)
    const read = (now: string) =>
      handleClaim(claimRequest(token), makeEnv(store), { now: () => new Date(now) })
    expect(await (await read('2026-10-19T00:00:00Z')).json()).toMatchObject({
      status: 'ready',
      key,
    })
    expect(await (await read('2026-10-19T00:59:00Z')).json()).toMatchObject({
      status: 'ready',
      key,
    })
    expect((await read('2026-10-19T01:01:00Z')).status).toBe(404)
  })

  it('领取码：付款前是 pending，未知的回 404', async () => {
    const { store, entries } = fakeStore()
    const pending = { status: 'pending', plan: 'premium-monthly', identity: 'u_x' }
    entries.set('claim:waiting', JSON.stringify(pending))
    const env = makeEnv(store)
    expect(await (await handleClaim(claimRequest('waiting'), env)).json()).toMatchObject({
      status: 'pending',
    })
    expect((await handleClaim(claimRequest('nope'), env)).status).toBe(404)
  })

  it('校验：未知或格式不对的密钥回 404', async () => {
    const env = makeEnv(fakeStore().store)
    for (const key of [newLicenseKey(), 'x']) {
      expect((await handleVerify(post('/api/license/verify', { key }), env)).status).toBe(404)
    }
  })

  it('校验：同一网络下的多台客户端不会很快被限流', async () => {
    const { store, entries } = fakeStore()
    const { key } = await activate(store, entries)
    for (let i = 0; i < 20; i++) expect((await verify(store, key)).ok).toBe(true)
  })

  it('门户：用许可证里记下的身份换链接，而不是请求里带来的任何东西', async () => {
    const { store, entries } = fakeStore()
    const { identity, key } = await activate(store, entries)
    const { deps, calls } = fakeClient()
    const response = await handlePortal(
      post('/api/license/portal', { key, buyerIdentity: 'u_attacker' }),
      makeEnv(store),
      deps,
    )
    expect(await response.json()).toMatchObject({
      ok: true,
      portalUrl: expect.stringContaining('#token='),
    })
    expect(calls.portal[0]).toEqual({ storeId: STORE_ID, buyerIdentity: identity })
  })
})
