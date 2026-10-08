# umuo.app

umuo 官网（[umuo.app](https://umuo.app)）与官网 API 的源码。

umuo 是 macOS 系统级 AI 翻译客户端。**客户端是闭源的，不在这个仓库**；这里只有：

- `apps/web` —— 官网（Vite + React 19 + Tailwind v4），构建期预渲染出简体中文 / 繁体中文 / English / 日本語 四个静态页面
- `worker` —— Cloudflare Worker：`/api/notify`（上线通知）与 `/api/health`

## 开发

```bash
bun install
bun run dev:web      # 官网 dev server（localhost:3000）
bun run dev:worker   # Worker 本地运行（需先 bun run build:web）
bun run verify       # lint + 类型检查 + 测试 + 构建
```

部署见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

## 许可

本仓库（官网与 Worker）以 MIT 许可发布，见 [`LICENSE`](LICENSE)。umuo 客户端不在此列。
