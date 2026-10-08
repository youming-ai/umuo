# 部署 umuo.app

官网与官网的 API 都跑在 Cloudflare Workers 上，Worker 名就是 `umuo`。
客户端是闭源的，不在本仓库，也不走这里。

```
umuo.app / www.umuo.app
├── /                → Cloudflare Worker `umuo`
│   ├── /api/notify  → worker/src/notify.ts（邮箱写进 KV）
│   ├── /api/health  → 探针：顺手读一次 KV，绑定坏了就 503
│   ├── /api/release → 最新客户端版本的元数据（R2 里的 macos/latest.json）
│   ├── /download/macos → 最新的 .dmg（worker/src/releases.ts）
│   └── 其余路径      → 静态资源层直接返回 apps/web/dist
└── 未命中的路径      → Worker 回 HTML 404（worker/src/index.ts）
```

## 配置在仓库根，不在这里

`wrangler.toml` 放在**仓库根**，`main` 指向 `worker/src/index.ts`。这不是风格问题：
Cloudflare 那个 `umuo` 服务的 root directory 就是仓库根，配置放错目录时
**构建直接失败，而日志只在 dashboard 里** —— 本地 `wrangler dev` 一切正常，
CI 也照样绿，只有 PR 上多一个红色的 `Workers Builds: umuo`。

## 这个 Worker 的绑定

| 绑定 | 类型 | 值 | 用途 |
| --- | --- | --- | --- |
| `NOTIFY_KV` | KV namespace | `umuo-notify`（id 在 `wrangler.toml` 里） | 上线通知的邮箱名单 |
| `RELEASES` | R2 bucket | `umuo-releases`（正式与预览共用，Worker 只读） | 客户端安装包 |
| `NOTIFY_KV`（预览） | KV namespace | `umuo-notify-preview` | PR 预览（`wrangler preview`）专用，与正式名单隔离 |

绑定 id 不是密钥，写在仓库里是有意的：它需要跟着代码一起 review。
真要放密钥用 `wrangler secret put`，不进 `wrangler.toml`、也不进 git。

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
| Root directory | 仓库根（`/`） |
| Build command | `bun run build:web`（`bun run build` 就是它） |
| Deploy command | `bunx wrangler deploy` |
| Production branch | `main` |

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

客户端在私有仓库 `youming-ai/umuo-app`。它的 `.github/workflows/release.yml` 在每次合进 `main` 时：

1. 编通用二进制（Apple Silicon + Intel）的 `.dmg`，版本号 `0.1.<运行序号>`；
2. 传到 R2 桶 `umuo-releases` 的 `macos/umuo-<版本>-universal.dmg`；
3. **最后**写 `macos/latest.json`（版本、key、大小、sha256、commit、时间）。

Worker 的 `/download/macos` 只认 latest.json，所以安装包没传完之前访客拿到的仍是上一版；
桶里还没有任何版本时返回 503「正在准备中」，而不是 404 或坏文件。

上传用的是 R2 的「对象读写」API Token（只授权给 `umuo-releases` 一个桶），存在私有仓库的
secret 里：`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT`。

安装包**还没有** Apple 开发者签名与公证：下载后首次打开会被 Gatekeeper 拦下，
官网下载按钮下方写明了怎么放行。要去掉这一步，需要 Apple Developer Program（$99/年）
并在工作流里加签名与公证。
