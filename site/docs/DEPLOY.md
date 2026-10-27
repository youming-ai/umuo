# 部署 umuo.app

官网与官网的 API 都跑在 Cloudflare Workers 上，Worker 名就是 `umuo`。
客户端是闭源的，不在本仓库，也不走这里。

```
umuo.app / www.umuo.app
├── /                → Cloudflare Worker `umuo`
│   ├── /api/notify  → worker/src/notify.ts（邮箱写进 KV）
│   ├── /api/health  → 探针：顺手读一次 KV，绑定坏了就 503
│   ├── /api/release → 最新客户端版本的元数据（R2 里的 macos/latest.json）
│   ├── /download/macos/update.json 与更新包 → 客户端自动更新（R2 里的 macos/update.json）
│   ├── /download/macos → 最新的 .dmg（worker/src/releases.ts）
│   ├── /api/checkout、/api/waffo/webhook、/api/license/* → Premium 收费与许可证（worker/src/billing.ts）
│   └── 其余路径      → 静态资源层直接返回 apps/web/dist
└── 未命中的路径      → Worker 回 HTML 404（worker/src/index.ts）
```

## 配置在仓库根，不在这里

`wrangler.jsonc` 放在**仓库根**，`main` 指向 `worker/src/index.ts`。这不是风格问题：
Cloudflare 那个 `umuo` 服务的 root directory 就是仓库根，配置放错目录时
**构建直接失败，而日志只在 dashboard 里** —— 本地 `wrangler dev` 一切正常，
CI 也照样绿，只有 PR 上多一个红色的 `Workers Builds: umuo-app`。

## 这个 Worker 的绑定

| 绑定 | 类型 | 值 | 用途 |
| --- | --- | --- | --- |
| `NOTIFY_KV` | KV namespace | `umuo-notify`（id 在 `wrangler.jsonc` 里） | 上线通知的邮箱名单 |
| `RELEASES` | R2 bucket | `umuo-releases`（Worker 只读） | 客户端安装包 |
| `RELEASES`（预览） | R2 bucket | `umuo-releases-preview`（空桶） | PR 预览专用，预览里的下载是 503 |
| `NOTIFY_KV`（预览） | KV namespace | `umuo-notify-preview` | PR 预览（`wrangler preview`）专用，与正式名单隔离 |
| `LICENSES` | KV namespace | `umuo-licenses` | Premium 许可证、结账领取码、webhook 去重 |
| `LICENSES`（预览） | KV namespace | `umuo-licenses-preview` | PR 预览专用 |
| `WAFFO_*` | 变量 / secret | 见下面「收费」 | Waffo Pancake 的商户、店铺、商品 ID 与私钥 |

绑定 id 不是密钥，写在仓库里是有意的：它需要跟着代码一起 review。
真要放密钥用 `wrangler secret put`，不进 `wrangler.jsonc`、也不进 git。
线上的 secret 只有 `WAFFO_PRIVATE_KEY`（收费）。早期遗留、代码不读的 `GROQ_API_KEY` 已于 2026-10-22 删除。

## 控制台设置也写进配置

域名、workers.dev、Preview URL 与日志这几项过去只在控制台上，`wrangler.jsonc` 里没写，
部署结果要靠 wrangler 的默认值与控制台碰巧一致。现在照控制台现状显式写上，改它们要走 review：

| 配置 | 值 | 说明 |
| --- | --- | --- |
| `routes` | `[{ "pattern": "umuo.app", "custom_domain": true }]` | 只有 `umuo.app`，**没有 www** |
| `workers_dev` | `true` | `umuo-app.<子域>.workers.dev` 开着 |
| `preview_urls` | `true` | 按版本的 Preview URL 开着（wrangler 配置里它的默认值是 `false`，与线上不同，所以必须写） |
| `observability` | 开；`logs` 开、`persist`、`invocation_logs`；`traces` 关 | 与控制台一致 |

改完配置先跑 `bunx wrangler deploy --dry-run`，核对它列出的绑定与 vars。

名单的形状（每条一个 key `notify:<小写邮箱>`）：

```json
{
  "email": "ada@example.com",
  "source": "macOS",
  "firstSeenAt": "2026-10-08T02:00:00.000Z",
  "lastSeenAt": "2026-10-08T02:00:00.000Z"
}
```

`firstSeenAt` 不会被重复提交覆盖 —— 「第一次愿意留邮箱」才是要看的数。
导出名单：

```bash
bunx wrangler kv key list --binding NOTIFY_KV --remote
```

单条邮箱的删除请求（`hint` 文案里承诺了「随时可以来信要求删除」）：
`bunx wrangler kv key delete --binding NOTIFY_KV --remote 'notify:<地址>'`。

## dashboard 侧的设置

Workers Builds 的 build / deploy 命令**不在仓库里**，改完要在 Cloudflare 控制台确认：

| 设置 | 值 |
| --- | --- |
| Git repository | `youming-ai/umuo-app` |
| Root directory | `site` |
| Build watch paths | 只包含 `site/*`（只改客户端时不构建官网） |
| Build command | `bun run build:web`（`bun run build` 就是它） |
| Deploy command | `bunx wrangler deploy` |
| Production branch | `main` |

`bunx wrangler` 跑的是 `node_modules` 里装好的 wrangler，不是现拉最新版：它在 `devDependencies`
里钉死为确切版本（当前 `4.151.0`，与 `void` → `@cloudflare/vite-plugin` 依赖的同一版，lockfile 里只有一份）。
线上部署用的工具版本因此由本仓库决定；升 `void` 时同时核对它带的 wrangler，二者一起改，
改完重跑 `bunx wrangler deploy --dry-run` 对一遍绑定、vars 与 assets。

### 两个会让 PR 变红的坑

1. **不要在这个 Worker 里加 Durable Object。** 预览构建跑的是
   `wrangler versions upload`，它应用不了 DO 迁移；一旦有待应用的迁移，
   **每个 PR** 的构建都会失败。限流因此用 KV 计数（见 `worker/src/notify.ts`
   的 `withinRateLimit`），它不精确，但对一个低价值端点够了。
2. **deploy command 里不要带本仓库没有的东西**（例如 `wrangler d1 migrations apply`）——
   这个服务曾经托管另一个项目，命令是那会儿留下的。

## 本地怎么验

```bash
bun run build:web        # 先生成 apps/web/dist，assets 目录必须存在
bun run dev:worker       # wrangler dev，本地 KV，不打云端
curl -s localhost:8787/api/health
```

不连云端也能验的还有 `bunx wrangler deploy --dry-run`：它读一遍 assets 目录、
打出绑定与包体大小，然后退出 —— 用来确认配置能被解析、`main` 能 resolve。

线上（部署完）不用账号就能验：

```bash
curl -s https://umuo.app/api/health          # {"ok":true,"service":"umuo-app"}
curl -s -o /dev/null -w '%{http_code}\n' https://umuo.app/     # 200
curl -s -o /dev/null -w '%{http_code}\n' https://umuo.app/nope # 404
```

## 隐私

官网从上线通知表单开始**会存邮箱**（KV 里），只用于发布时发一封通知。
文案已经改成如实描述（不再写「官网不保存邮箱」）。上线前还缺三份法务页面
（服务条款、隐私政策、可接受使用政策）—— 收邮箱这件事应当写进隐私政策。

## 客户端安装包从哪来

客户端在同一仓库的根目录。仓库的 `.github/workflows/release.yml`（只改 `site/` 时不触发） 在每次合进 `main` 时：

1. 编通用二进制（Apple Silicon + Intel）的 `.dmg`，版本号 `0.1.<运行序号>`；
2. 传到 R2 桶 `umuo-releases` 的 `macos/umuo-<版本>-universal.dmg`；
3. **最后**写 `macos/latest.json`（版本、key、大小、sha256、commit、时间）。

Worker 的 `/download/macos` 只认 latest.json，所以安装包没传完之前访客拿到的仍是上一版；
桶里还没有任何版本时返回 503「正在准备中」，而不是 404 或坏文件。

**自动更新**（客户端的 tauri-plugin-updater）走同一个桶：工作流配了 `TAURI_SIGNING_PRIVATE_KEY`
时，先传 `macos/umuo-<版本>-universal.app.tar.gz`，再写 `macos/update.json` 指向它。
Worker 的 `/download/macos/<文件>` 只放行这两种文件名；`update.json` 不存在时回 204（客户端当作没有新版）。
包的完整性由客户端内置公钥验签保证，不依赖 Worker。

上传用的是 R2 的「对象读写」API Token（只授权给 `umuo-releases` 一个桶），存在仓库的
secret 里：`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT`。

安装包**还没有** Apple 开发者签名与公证：下载后首次打开会被 Gatekeeper 拦下，
官网下载按钮下方写明了怎么放行。要去掉这一步，需要 Apple Developer Program（$99/年）
并在工作流里加签名与公证。

## 收费（Waffo Pancake）

Premium 是客户端的功能解锁，模型仍由用户自带 Key。收款方是 Waffo Pancake（Merchant of Record，
代收税费，3.9% + $0.50 每笔）。没有账号系统：每次结账随机生成一个买家身份，凭证是许可证密钥。

```
定价页 → POST /api/checkout {plan, email} → Waffo 收银台（新标签页）
       → 付款成功 → Waffo 回调 POST /api/waffo/webhook → 生成密钥
       → 跳回 /activate?claim=… → GET /api/license/claim 拿到密钥 → 交给客户端
客户端 → POST /api/license/verify {key}（定期校验）
       → POST /api/license/portal {key} → Waffo 客户门户（取消、换卡、发票）
```

**没配齐 `vars` 与私钥中的任何一项，收费接口都回 503**，所以代码可以先部署。

### 配置步骤

商户 ID 与店铺 ID 已写在 `wrangler.jsonc` 的 `vars`（不是密钥），环境是 `prod`。剩下的：

1. **私钥**：在 Waffo 后台「API 与开发」建一把**正式环境**的 API Key，下载私钥文件，从文件写入
   （多行内容手动粘贴容易丢换行）。不要发给任何人，也不要提交：

   ```bash
   bunx wrangler secret put WAFFO_PRIVATE_KEY < ~/path/to/private.pem
   ```

2. **建商品与 webhook**：在本机跑一次初始化脚本（私钥只在本机读取）：

   ```bash
   bun run scripts/waffo-setup.ts ~/path/to/private.pem
   ```

   它会建好 Premium 月付（$2.99，试用 1 天）与年付（$29.90，试用 3 天）两个订阅商品，
   组成套餐组（共享试用、顾客可在门户里自助切换），为 `WAFFO_ENV` 这个环境注册一条
   `https://umuo.app/api/waffo/webhook`，最后把两个商品 ID 写回 `wrangler.jsonc`（只改那一行，注释原样保留）。提交并合并后生效。
   先加 `--dry-run` 跑一遍能看到每一步会做什么（不要私钥、不发请求、不写文件）。
   东西建在私钥所属的环境里，所以私钥必须与 `WAFFO_ENV` 同一环境。可以放心重跑：每完成一步都立刻记下，已完成的步骤直接跳过（进度文件 `scripts/.waffo-setup-state.json` 不提交）。

3. **店铺资料**：在 Waffo 后台的店铺设置里填支持邮箱 `hello@umuo.app` 与网站 `https://umuo.app`
   （SDK 改不了这两项，审核要求与网站一致）。

4. **审核**：提交店铺审核（Business Details）。要求：产品真的能用、没有「即将推出」占位，定价页写清每档价格与续费周期，
   条款与隐私政策链接在页脚。审核通过前正式环境的结账会被拒；定价页的购买入口也要等客户端支持许可证、按买断商品重写后再接入。

### 设计上的几个取舍

- **身份随机、不由邮箱推导**：结账会给这个身份签发 Waffo 的客户会话令牌（能取消订阅、查订单），能由邮箱算出身份的话，知道别人邮箱就能拿到别人的令牌。代价是换身份可以再领一次试用（要填真卡，试用 1–3 天）。
- **许可证按身份存，不按订单存**：换套餐时 Waffo 生成新订单，身份不变，密钥跟着走。
- **webhook 核对店铺**：签名密钥是平台级的（所有店铺共用），只验签不核对 `storeId` 的话，别的店铺的事件也能改我们的许可证。
- **去重按「事件类型 + eventId」**：同一订单的不同事件顶层 `id` 相同，只按 `id` 去重会吞掉续费、取消等后续事件。
- **乱序与回退**：比上次采纳的事件旧的事件一律忽略；已取消、已退款的订单不再回退。
- **退款即收回 Premium**（我们的退款都是全额）。
- **KV 只存密钥的哈希**：密钥经由领取码交付，首次领取后只再给 1 小时（刷新激活页用），之后失效。
- **宽限 3 天**：账期结束后仍认 3 天，覆盖续费重试与 webhook 晚到。
- **webhook 必须读原始文本再验签**，先解析 JSON 会让签名失效。
- 还没做：丢失密钥后的自助找回（目前走支持邮箱）、按设备数限制。
