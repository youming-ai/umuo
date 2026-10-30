# umuo.app 部署

官网（Vite + React）与 API（Void 中间件）运行在同一个 Cloudflare Worker：`umuo-app`。
仓库以 `void.config.ts` 为 Worker 配置来源，使用 Void 部署、Vite 构建、`cf` 管理 Cloudflare 资源。

线上已使用 Void 构建并通过 `cf` 部署；接管记录与 Workers Builds 设置见 [VOID-MIGRATION.md](VOID-MIGRATION.md)。

## 配置和资源

`void.config.ts` 声明自定义域名 `umuo.app`、`nodejs_compat`、访问开关与现有绑定：

| 绑定 | 资源 | 用途 |
| --- | --- | --- |
| `ASSETS` | Vite 生成的静态资源 | 五语言预渲染页面 |
| `NOTIFY_KV` | `umuo-notify` | 上线通知邮箱 |
| `LICENSES` | `umuo-licenses` | 买断许可证（含已激活设备）、领取码与 webhook 去重 |
| `RELEASES` | `umuo-releases` | 客户端安装包与更新清单 |
| `WAFFO_*` | 变量与远端 secret | Waffo 收费配置（买断商品 `WAFFO_PRODUCT_LICENSE`） |

`WAFFO_PRIVATE_KEY` 是远端 secret；其他 Waffo 值是非密钥 ID。`WAFFO_PRODUCT_LICENSE` 在正式环境建好商品前是注释占位，
此时 `/api/checkout`、webhook 与门户回 503。

变更正式资源或路由前检查配置并运行 `scripts/void-config.test.ts`。

## 开发与验证

需要 Bun ≥ 1.2、Node ≥ 24.21。本机默认 Node 较低时，可在以下命令前加 `mise exec node@24 --`。

```bash
bun install --frozen-lockfile
bun run build:web        # 为 Worker 开发准备预渲染页面
bun run dev:worker       # Vite + Void，本地 KV / R2
bun run verify           # lint、类型、Vitest、官网与 Worker 构建
```

构建后的 `dist/ssr/wrangler.json` 和 `.void-wrangler.jsonc` 是 Void / Cloudflare 插件生成物，
不可作为配置来源提交。`void.lock.json` 在实际关联部署并记录资源后提交。
静态资源走 Void Worker 后再通过 `ASSETS` 返回。

## Cloudflare 与生产部署

使用 `bunx cf auth whoami` 查看 cf 身份；登录或切换账户使用 `bunx cf auth login`。
构建与部署入口是（`deploy` 用 `cf deploy --prebuilt` 部署 Void 构建产物，见 `scripts/cf-deploy.ts`）：

```bash
bun run build
bun run deploy
```

`cf` 从最新上传版本继承 secret；部署前的 secret 核对、Workers Builds 与回滚按 [迁移手册](VOID-MIGRATION.md) 执行。
正式配置显式关闭 `workers_dev` 和 `preview_urls`；不要为通过就绪检查擅自打开生产公开入口。
域名、绑定、secret、活动版本及旧构建设置必须在切换前后核对。

## 收费

一次性买断，Waffo Pancake 代收；接口与规则见 `worker/src/billing.ts` 文件头。上线顺序（test 与 prod 各走一遍，
`WAFFO_ENV` 与私钥环境必须一致）：

1. `bun run scripts/waffo-setup.ts --dry-run` 看计划；再带私钥运行：建 US$9 一次性商品（`TaxCategory.Software`，不含税），
   把 ID 写回 `void.config.ts` 的 `WAFFO_PRODUCT_LICENSE`，并把店铺里指向 `/api/waffo/webhook` 的 webhook 改为只订阅
   `order.completed`、`refund.succeeded`（没有就新建）。
2. 在 Waffo 后台把订阅时代的月付 / 年付商品与套餐组设为 inactive。
3. 验收。正式 Worker 的 `WAFFO_ENV` 是 `prod`，test 模式的事件会被忽略（staging Worker 已删除），所以分两种：
   - **test**：本地 `bun run dev:worker`，用测试私钥并把 `WAFFO_ENV` 覆盖为 `test`、填入测试商品 ID；
     webhook 要经隧道转回本机才能验到领密钥，否则只能确认结账页能打开。不要把 test 商品 ID 提交进 `void.config.ts`。
   - **prod**：提交 `void.config.ts` 并合并部署后，用真实小额购买走一遍：结账 → 激活页领密钥 → 激活 / 解绑 →
     Waffo 后台退款 → verify 变为 `revoked`。
4. 最后把 `apps/web/src/config.ts` 的 `PURCHASE_OPEN` 改为 `true` 合并，官网才出现购买按钮。

## 客户端安装包

安装包的发布与更新通道见根目录 `docs/SWIFTUI-MIGRATION.md`。`release:swift` 默认只产出文件，
显式 `--publish` 才使用 `cf` 将包与清单上传 R2；先传包、最后更新 `macos/latest.json`。
发布前须在 `site/` 执行 `bun install --frozen-lockfile`，安装锁定版本的 `cf`。
Worker 为下载及更新接口设置响应缓存头。`cf` 当前对象上传单次上限为 300 MB；更大的包需先选择支持分片上传的方案。
