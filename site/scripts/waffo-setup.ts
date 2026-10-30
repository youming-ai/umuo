/**
 * 一次性初始化 Waffo 店铺：建 US$9 的一次性买断商品，注册（或更新）webhook，
 * 把商品 ID 写回 void.config.ts 的 WAFFO_PRODUCT_LICENSE。
 *
 * 东西建在私钥所属的环境里（正式 Key → 正式环境），不再「从测试发布到正式」：用正式 Key
 * 建的商品没有测试版本，publish 会报 `No test version found`。所以私钥的环境必须与
 * void.config.ts 的 WAFFO_ENV 一致。
 *
 * 商户 ID 与店铺 ID 读 void.config.ts；私钥只在本机读取，不打印、不写任何文件：
 *
 *   bun run scripts/waffo-setup.ts ~/path/to/private.pem
 *   # 或
 *   WAFFO_PRIVATE_KEY="$(cat ~/path/to/private.pem)" bun run scripts/waffo-setup.ts
 *   # 只看会做什么（不要私钥、不发请求、不写文件）
 *   bun run scripts/waffo-setup.ts --dry-run
 *
 * 可以放心重跑：商品 ID 一写回 void.config.ts 就跳过建商品；webhook 先按地址与环境在店铺里查，
 * 已有就把订阅的事件改成下面这两种（订阅时代注册的那个会被就地改掉），没有才新建；
 * 创建请求另带固定的 idempotency key。
 *
 * 价格不含税（Waffo 结账时按地区计税，与定价页的说明一致）。试用（7 天）由客户端本地处理，
 * 不设在商品上；退款（14 天内）在 Waffo 后台或客户门户里操作，webhook 收到后 Worker 吊销许可证。
 *
 * 订阅时代建的两个商品（月付 / 年付）与套餐组不会被删除：在 Waffo 后台把它们设为 inactive。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TaxCategory, WaffoPancake } from '@waffo/pancake-ts'
import { readVar, writeVar } from './void-vars'

const VOID_CONFIG = join(import.meta.dirname, '..', 'void.config.ts')
const WEBHOOK_URL = 'https://umuo.app/api/waffo/webhook'
const PRODUCT_VARIABLE = 'WAFFO_PRODUCT_LICENSE'

/** worker/src/billing.ts 处理的全部事件：付款成功签发许可证，退款吊销 */
const WEBHOOK_EVENTS = ['order.completed', 'refund.succeeded'] as const

const PRODUCT = {
  name: 'umuo for Mac (lifetime license)',
  amount: '9.00',
  // 一次性买断的桌面软件：按 software 计税（订阅时代用的是 saas）
  taxCategory: TaxCategory.Software,
  description:
    'One-time purchase of umuo for macOS. Activates up to 3 Macs, free updates for life, refundable within 14 days. Models run on your own API key; no subscription and no account.',
} as const

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

let config = readFileSync(VOID_CONFIG, 'utf8')
const merchantId = readVar(config, 'WAFFO_MERCHANT_ID')
const storeId = readVar(config, 'WAFFO_STORE_ID')
if (!merchantId || !storeId) {
  console.error('void.config.ts 的 vars 里缺 WAFFO_MERCHANT_ID 或 WAFFO_STORE_ID')
  process.exit(1)
}

const environment = readVar(config, 'WAFFO_ENV')
if (environment !== 'prod' && environment !== 'test') {
  console.error('void.config.ts 的 vars 里 WAFFO_ENV 必须是 prod 或 test')
  process.exit(1)
}
const testMode = environment === 'test'

// --dry-run：只读配置，列出每一步会做什么；不要私钥、不发请求、不写文件
if (process.argv.includes('--dry-run')) {
  console.log(`环境 ${environment}，商户 ${merchantId}，店铺 ${storeId}`)
  const known = readVar(config, PRODUCT_VARIABLE)
  console.log(
    known
      ? `· ${PRODUCT.name}：已有 ${known}，会跳过`
      : `+ ${PRODUCT.name}（US$${PRODUCT.amount} 一次性，不含税）：会创建并写回 ${PRODUCT_VARIABLE}`,
  )
  console.log(
    `~ webhook（${environment}）→ ${WEBHOOK_URL}：已有则把事件改成 ${WEBHOOK_EVENTS.join(' / ')}，没有则注册`,
  )
  process.exit(0)
}

const client = new WaffoPancake({ merchantId, privateKey: loadPrivateKey() })
/** 同一个商户、同一步操作用同一个 key：24 小时内重跑不会重复创建 */
const key = (step: string) => `${merchantId}-umuo-setup-${step}-v2`

const known = readVar(config, PRODUCT_VARIABLE)
if (known) {
  console.log(`· ${PRODUCT.name}：已有 ${known}，跳过`)
} else {
  const { product } = await client.onetimeProducts.create(
    {
      storeId,
      name: PRODUCT.name,
      description: PRODUCT.description,
      prices: { USD: { amount: PRODUCT.amount, taxCategory: PRODUCT.taxCategory } },
    },
    { idempotencyKey: key(PRODUCT_VARIABLE) },
  )
  config = writeVar(config, PRODUCT_VARIABLE, product.id)
  writeFileSync(VOID_CONFIG, config)
  console.log(`✓ ${PRODUCT.name}：${product.id}（US$${PRODUCT.amount}，已写回 void.config.ts）`)
}

// 只为 WAFFO_ENV 这个环境注册：Worker 只用这个环境的公钥验签，另一个环境的投递只会被拒
interface StoreWebhooksQuery {
  store: { storeWebhooks: Array<{ id: string; url: string; testMode: boolean; events: string[] }> }
}
const { data, errors } = await client.graphql.query<StoreWebhooksQuery>({
  query: 'query ($id: ID!) { store(id: $id) { storeWebhooks { id url testMode events } } }',
  variables: { id: storeId },
})
if (!data?.store) {
  // 查不到就不盲目新建：同一地址挂两个 webhook 会让退款事件投两遍
  console.error(
    `查询店铺 webhook 失败${errors?.length ? `：${errors.map((error) => error.message).join('; ')}` : ''}。` +
      `请在 Waffo 后台把 ${WEBHOOK_URL}（${environment}）的事件改成 ${WEBHOOK_EVENTS.join(' / ')}。`,
  )
  process.exit(1)
}
const existing = data.store.storeWebhooks.find(
  (webhook) => webhook.url === WEBHOOK_URL && webhook.testMode === testMode,
)
const wanted = [...WEBHOOK_EVENTS].sort().join(',')
if (existing && [...existing.events].sort().join(',') === wanted) {
  console.log(`· webhook（${environment}）：已订阅 ${WEBHOOK_EVENTS.join(' / ')}，跳过`)
} else if (existing) {
  await client.webhooks.update({ id: existing.id, events: [...WEBHOOK_EVENTS] })
  console.log(
    `✓ webhook（${environment}）：事件由 ${existing.events.join(' / ')} 改为 ${WEBHOOK_EVENTS.join(' / ')}`,
  )
} else {
  await client.webhooks.add(
    { storeId, channel: 'http', url: WEBHOOK_URL, events: [...WEBHOOK_EVENTS], testMode },
    { idempotencyKey: key(`webhook-${environment}`) },
  )
  console.log(`✓ webhook（${environment}）→ ${WEBHOOK_URL}`)
}

console.log(
  `\n完成。void.config.ts 的 ${PRODUCT_VARIABLE} 已更新：提交它并合并部署；` +
    '官网购买入口另由 apps/web/src/config.ts 的 PURCHASE_OPEN 打开。',
)
