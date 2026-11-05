# umuo.app

umuo 官网（[umuo.app](https://umuo.app)）与官网 API 的源码。

umuo 是 macOS 系统级 AI 翻译客户端，客户端在仓库根目录；`site/` 是独立的 Bun 项目，命令都在这里跑，只有：

- `apps/web` —— 官网（Vite + React 19 + Tailwind v4），构建期预渲染出简体中文 / 繁体中文 / English / 日本語 / 한국어 五种语言；只有首页（`/pricing`、`/terms`、`/privacy` 已删除，旧地址返回 404）
- `worker` —— Cloudflare Worker：按语言返回预渲染页，以及 `/download/macos`（302 到 GitHub Releases 最新版的 `umuo-v<版本>.dmg`；`/download/macos/appcast.xml` 同样跳到最新的 Sparkle 清单）、`/api/health`

## 开发

需要 Bun ≥ 1.4（版本以 `package.json` 的 `packageManager` 为准）和 Node ≥ 24.21。官网运行在 Vite，Worker 使用 Void；Cloudflare 资源用 `cf` 管理。

```bash
bun install
bun run dev:web      # 官网 dev server（localhost:3000）
bun run dev:worker   # Worker 本地运行（需先 bun run build:web）
bun run verify       # lint + 类型检查 + 测试 + 官网与 Worker 构建
```

本机默认 Node 较低时，使用 `mise exec node@24 -- bun run verify`。部署见 [`docs/DEPLOY.md`](docs/DEPLOY.md)；
生产由 Wrangler 切换至 Void 的接管记录与 Workers Builds 设置见 [`docs/VOID-MIGRATION.md`](docs/VOID-MIGRATION.md)。

## 许可

与仓库其余部分一样采用 [MIT](../LICENSE) 许可证；「umuo」名称与图标不随 MIT 授权。字体等第三方资源按各自的许可使用（如 `apps/web/public/fonts/*/OFL.txt`）。
