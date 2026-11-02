# umuo.app

umuo 官网（[umuo.app](https://umuo.app)）与官网 API 的源码。

umuo 是 macOS 系统级 AI 翻译客户端，客户端在仓库根目录；`site/` 是独立的 Bun 项目，命令都在这里跑，只有：

- `apps/web` —— 官网（Vite + React 19 + Tailwind v4），构建期预渲染出简体中文 / 繁体中文 / English / 日本語 / 한국어 五种语言；页面有首页、`/terms`、`/privacy`（旧的 `/pricing` 301 回首页）
- `worker` —— Cloudflare Worker：按语言返回预渲染页，以及 `/api/release` 与 `/download/macos`（读 R2 里的最新客户端）、`/api/notify`（上线通知；首页目前没有表单在用）、`/api/health`

## 开发

需要 Bun ≥ 1.2 和 Node ≥ 24.21。官网运行在 Vite，Worker 使用 Void；Cloudflare 资源用 `cf` 管理。

```bash
bun install
bun run dev:web      # 官网 dev server（localhost:3000）
bun run dev:worker   # Worker 本地运行（需先 bun run build:web）
bun run verify       # lint + 类型检查 + 测试 + 官网与 Worker 构建
```

本机默认 Node 较低时，使用 `mise exec node@24 -- bun run verify`。部署见 [`docs/DEPLOY.md`](docs/DEPLOY.md)；
生产由 Wrangler 切换至 Void 前的顺序与限制见 [`docs/VOID-MIGRATION.md`](docs/VOID-MIGRATION.md)。

## 许可

umuo 客户端将以 MIT 许可证开源；官网代码（`site/`）的许可待仓库公开时决定。字体等第三方资源按各自的许可使用（如 `apps/web/public/fonts/*/OFL.txt`）。
