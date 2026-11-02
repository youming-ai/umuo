# umuo.app 部署

官网（Vite + React）与 API（Void 中间件）运行在同一个 Cloudflare Worker：`umuo`（2026-11-02 由 `umuo-app` 改名）。
仓库以 `void.config.ts` 为 Worker 配置来源，使用 Void 部署、Vite 构建、`cf` 管理 Cloudflare 资源。

线上已使用 Void 构建并通过 `cf` 部署；接管记录与 Workers Builds 设置见 [VOID-MIGRATION.md](VOID-MIGRATION.md)。

## 配置和资源

`void.config.ts` 声明自定义域名 `umuo.app`、`nodejs_compat`、访问开关与绑定：

| 绑定 | 资源 | 用途 |
| --- | --- | --- |
| `ASSETS` | Vite 生成的静态资源 | 五语言预渲染页面 |
| `VERSION_METADATA` | 版本元数据 | Void 就绪探针 |

Worker 没有 KV / R2 绑定：上线通知表单与 `/api/notify` 已删除（原 KV `umuo-notify`），
客户端安装包改由 GitHub Releases 提供（原 R2 桶 `umuo-releases` 已删除）。`scripts/check-void-build.ts` 核对构建输出里只有上面这些绑定。

umuo 免费开源，Worker 没有收费接口，也不需要任何 secret 或变量。`nodejs_compat` 仍要保留：
Void 运行时用到 `node:async_hooks`。

变更正式资源或路由前检查配置并运行 `scripts/void-config.test.ts`。

## 开发与验证

需要 Bun ≥ 1.2、Node ≥ 24.21。本机默认 Node 较低时，可在以下命令前加 `mise exec node@24 --`。

```bash
bun install --frozen-lockfile
bun run build:web        # 为 Worker 开发准备预渲染页面
bun run dev:worker       # Vite + Void
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

安装包在 GitHub Releases（客户端改动合入 main 时由根目录 `.github/workflows/release.yml` 发布，见 `docs/SWIFTUI-MIGRATION.md`），
官网不存任何安装包。Worker 只做 302 跳转（`no-store`）：

| 路径 | 跳到 |
| --- | --- |
| `/download/macos` | `https://github.com/youming-ai/umuo/releases/latest/download/umuo.dmg` |
| `/download/macos/appcast.xml` | `https://github.com/youming-ai/umuo/releases/latest/download/appcast.xml` |

`/download/macos/` 下的其他旧地址（`update.json`、`latest.json`、带版本号的安装包与更新包）与 `/api/release` 已删除，返回 404。
