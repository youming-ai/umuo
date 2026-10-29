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
| `LICENSES` | `umuo-licenses` | 旧支付链路的许可证与 webhook 去重 |
| `RELEASES` | `umuo-releases` | 客户端安装包与更新清单 |
| `WAFFO_*` | 变量与远端 secret | 旧支付链路配置 |

`WAFFO_PRIVATE_KEY` 是远端 secret；其他 Waffo 值是非密钥 ID。配置不提供当前产品的购买入口，
旧订阅支付实现须在买断支付方案定案后另行调整，不以这些变量视作购买流程已完成。

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

## 客户端安装包

安装包的发布与更新通道见根目录 `docs/SWIFTUI-MIGRATION.md`。`release:swift` 默认只产出文件，
显式 `--publish` 才使用 `cf` 将包与清单上传 R2；先传包、最后更新 `macos/latest.json`。
发布前须在 `site/` 执行 `bun install --frozen-lockfile`，安装锁定版本的 `cf`。
Worker 为下载及更新接口设置响应缓存头。`cf` 当前对象上传单次上限为 300 MB；更大的包需先选择支持分片上传的方案。
