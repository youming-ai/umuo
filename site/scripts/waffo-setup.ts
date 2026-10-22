/**
 * 一次性初始化 Waffo 店铺：建 Premium 月付 / 年付两个订阅商品与套餐组，注册 webhook，
 * 把两个商品 ID 写回 wrangler.jsonc 的 vars。
 *
 * 东西建在私钥所属的环境里（正式 Key → 正式环境），不再「从测试发布到正式」：用正式 Key
 * 建的商品没有测试版本，publish 会报 `No test version found`。所以私钥的环境必须与
 * wrangler.jsonc 的 WAFFO_ENV 一致。
 *
 * 商户 ID 与店铺 ID 读 wrangler.jsonc；私钥只在本机读取，不打印、不写任何文件：
 *
 *   bun run scripts/waffo-setup.ts ~/path/to/private.pem
 *   # 或
 *   WAFFO_PRIVATE_KEY="$(cat ~/path/to/private.pem)" bun run scripts/waffo-setup.ts
 *   # 只看会做什么（不要私钥、不发请求、不写文件）
 *   bun run scripts/waffo-setup.ts --dry-run
 *
 * 可以放心重跑：每完成一步都立刻记下（商品 ID 写回 wrangler.jsonc，套餐组与 webhook 记在
 * scripts/.waffo-setup-state.json），已完成的步骤直接跳过；创建请求另带固定的 idempotency key。
 *
 * 价格不含税（Waffo 结账时按地区计税，与定价页的说明一致）；试用天数写在商品的
 * metadata.trialDays；套餐组打开 sharedTrial（月付与年付合计只给一次试用）与
 * selfServicePlanChange（顾客可以在客户门户里自己在月付与年付之间切换）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BillingPeriod, TaxCategory, WaffoPancake } from '@waffo/pancake-ts'
import { readVar, writeVar } from './wrangler-vars'

const WRANGLER = join(import.meta.dirname, '..', 'wrangler.jsonc')
const WEBHOOK_URL = 'https://umuo.app/api/waffo/webhook'

/** worker/src/billing.ts 处理的全部事件：订阅状态类事件都带 orderStatus 与 currentPeriodEnd */
const WEBHOOK_EVENTS = [
  'subscription.activated',
  'subscription.renewed',
  'subscription.recovered',
  'subscription.canceling',
  'subscription.uncanceled',
  'subscription.plan_changed',
  'subscription.canceled',
  'subscription.past_due',
  'refund.succeeded',
] as const

const PLANS = [
  {
    variable: 'WAFFO_PRODUCT_PREMIUM_MONTHLY',
    name: 'umuo Premium (Monthly)',
    billingPeriod: BillingPeriod.Monthly,
    amount: '2.99',
    trialDays: 1,
  },
  {
    variable: 'WAFFO_PRODUCT_PREMIUM_YEARLY',
    name: 'umuo Premium (Yearly)',
    billingPeriod: BillingPeriod.Yearly,
    // 年付按 10 个月收（少付 2 个月）
    amount: '29.90',
    trialDays: 3,
  },
] as const

const DESCRIPTION =
  'Unlocks umuo Premium on macOS: AI word cards, multi-model comparison, custom styles, glossaries, per-app target language, per-feature models, spending limits, and searchable history. Models run on your own API key.'

function loadPrivateKey(): string {
  const path = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
  const key = path ? readFileSync(path, 'utf8') : process.env.WAFFO_PRIVATE_KEY
  if (!key?.trim()) {
    console.error(
      '缺少私钥。用法：bun run scripts/waffo-setup.ts <private.pem>（或设置 WAFFO_PRIVATE_KEY；只想看看会做什么加 --dry-run）',
    )
    process.exit(1)
  }
  return key
}

let config = readFileSync(WRANGLER, 'utf8')
const merchantId = readVar(config, 'WAFFO_MERCHANT_ID')
const storeId = readVar(config, 'WAFFO_STORE_ID')
if (!merchantId || !storeId) {
  console.error('wrangler.jsonc 的 vars 里缺 WAFFO_MERCHANT_ID 或 WAFFO_STORE_ID')
  process.exit(1)
}

const environment = readVar(config, 'WAFFO_ENV')
if (environment !== 'prod' && environment !== 'test') {
  console.error('wrangler.jsonc 的 vars 里 WAFFO_ENV 必须是 prod 或 test')
  process.exit(1)
}

/**
 * 进度一步一记，中途失败、隔多久重跑都不会重复创建：商品 ID 立刻写回 wrangler.jsonc，
 * 套餐组与 webhook 记在不提交的状态文件里（idempotency key 只保 24 小时）。
 */
const STATE = join(import.meta.dirname, '.waffo-setup-state.json')
const state: { groupId?: string; webhooks?: Record<string, boolean> } = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, 'utf8'))
  : {}

// --dry-run：只读配置与状态文件，列出每一步会做什么；不要私钥、不发请求、不写文件
if (process.argv.includes('--dry-run')) {
  console.log(`环境 ${environment}，商户 ${merchantId}，店铺 ${storeId}`)
  for (const plan of PLANS) {
    const known = readVar(config, plan.variable)
    console.log(
      known
        ? `· ${plan.name}：已有 ${known}，会跳过`
        : `+ ${plan.name}：会创建并写回 ${plan.variable}`,
    )
  }
  console.log(
    state.groupId ? `· 套餐组：已有 ${state.groupId}，会跳过` : '+ 套餐组 umuo Premium：会创建',
  )
  console.log(
    state.webhooks?.[environment]
      ? `· webhook（${environment}）：已注册，会跳过`
      : `+ webhook（${environment}）→ ${WEBHOOK_URL}：会注册`,
  )
  process.exit(0)
}

const client = new WaffoPancake({ merchantId, privateKey: loadPrivateKey() })
/** 同一个商户、同一步操作用同一个 key：24 小时内重跑不会重复创建 */
const key = (step: string) => `${merchantId}-umuo-setup-${step}-v1`

const saveState = () => writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`)

const productIds: string[] = []
for (const plan of PLANS) {
  const known = readVar(config, plan.variable)
  if (known) {
    productIds.push(known)
    console.log(`· ${plan.name}：已有 ${known}，跳过`)
    continue
  }
  const { product } = await client.subscriptionProducts.create(
    {
      storeId,
      name: plan.name,
      description: DESCRIPTION,
      billingPeriod: plan.billingPeriod,
      prices: { USD: { amount: plan.amount, taxCategory: TaxCategory.SaaS } },
      metadata: { trialDays: plan.trialDays },
    },
    { idempotencyKey: key(plan.variable) },
  )
  productIds.push(product.id)
  config = writeVar(config, plan.variable, product.id)
  writeFileSync(WRANGLER, config)
  console.log(
    `✓ ${plan.name}：${product.id}（$${plan.amount}，试用 ${plan.trialDays} 天，已写回 wrangler.jsonc）`,
  )
}

if (state.groupId) {
  console.log(`· 套餐组：已有 ${state.groupId}，跳过`)
} else {
  const { group } = await client.subscriptionProductGroups.create(
    {
      storeId,
      name: 'umuo Premium',
      rules: { sharedTrial: true, selfServicePlanChange: true },
      productIds,
    },
    { idempotencyKey: key('group') },
  )
  state.groupId = group.id
  saveState()
  console.log(`✓ 套餐组 umuo Premium：${group.id}（共享试用、可自助切换月付 / 年付）`)
}

// 只为 WAFFO_ENV 这个环境注册：Worker 只用这个环境的公钥验签，另一个环境的投递只会被拒
const testMode = environment === 'test'
state.webhooks ??= {}
if (state.webhooks[environment]) {
  console.log(`· webhook（${environment}）：已注册，跳过`)
} else {
  await client.webhooks.add(
    { storeId, channel: 'http', url: WEBHOOK_URL, events: [...WEBHOOK_EVENTS], testMode },
    { idempotencyKey: key(`webhook-${environment}`) },
  )
  state.webhooks[environment] = true
  saveState()
  console.log(`✓ webhook（${environment}）→ ${WEBHOOK_URL}`)
}

console.log('\n完成。wrangler.jsonc 里的两个商品 ID 已更新：提交它，然后合并部署。')
