# umuo — AI football news

umuo 现在是一个只面向足球资讯的 AI 新闻站。它从 BBC Sport、The Guardian、Sky Sports 和 ESPN 的足球源抓取文章，由 Gemini 负责足球过滤、联赛归类、摘要、标签和质量评分，再通过 Cloudflare Queue 投递给 Durable Object Agent，最后写入 D1。Astro SSR 直接从 D1 读取首屏，React island 负责搜索、筛选和分页。

## 架构

```mermaid
graph LR
  Cron[Cloudflare Cron] --> Fetch[Feed fetcher]
  Fetch --> Normalize[URL canonicalize + SHA-256 dedupe]
  Normalize --> Queue[Cloudflare Queue]
  Queue --> Agent[FootballNewsAgent Durable Object]
  Agent --> Gemini[Gemini structured output]
  Agent --> D1[(Cloudflare D1)]
  Browser --> Astro[Astro SSR]
  Astro --> D1
  Browser --> Explore[/api/explore]
  Explore --> KV[KV edge cache]
  KV --> D1
```

Cloudflare 能力分工：

- D1：sources、source health、AI 处理后的 articles、tags 和去重 cluster。
- Queue：把抓取和 LLM 处理拆开，避免 Cron 请求被 Gemini 延迟拖住；失败消息进入重试和 dead-letter queue。
- Durable Object / Agents SDK：`FootballNewsAgent` 作为有状态、可串行化的处理入口；按 fingerprint/canonical URL 幂等写入。
- Cron：每 15 分钟抓取资讯；每天 07:00 UTC 再跑一次补偿抓取。
- KV：只缓存 Explore 查询结果和仍在兼容期的旧 ESPN 数据接口。
- Worker custom entrypoint：`worker/entrypoint.ts` 同时承载 Astro SSR、scheduled、queue 和 Agent class export。

## 产品入口

- `/`：AI football news 首页，包含搜索、competition/source/tag 筛选的资讯探索页。
- `/<competition>`：某个足球联赛的 AI 新闻页，例如 `/eng.1`、`/esp.1`。
- `/rss.xml`、`/<competition>/rss.xml`：可订阅的 RSS 2.0 源，读者可加入 NetNewsWire / Feedly 等阅读器，每个联赛一份独立的 feed。
- `/sitemap.xml`：站点地图（页面 + 一份 feed/联赛对）。

公开导航和新资讯链路只使用 `FOOTBALL_COMPETITIONS`。旧的 NBA/ESPN 比赛数据模块仍保留在代码中，用于兼容已有测试和历史链接；它们不再出现在新的资讯导航和首页数据链路中，可在后续清理阶段移除。

## 目录

```text
src/feeds/                 source registry, RSS parser, ingest, Gemini, queue
src/agents/                FootballNewsAgent Durable Object
src/data/api.ts            D1 Explore queries + KV cache + legacy ESPN composers
src/components/explore/   Explore SSR island and article cards
src/pages/index.astro     global Explore page
src/pages/rss.xml.ts      RSS 2.0 endpoint at /rss.xml
src/pages/[comp]/rss.xml.ts   per-competition RSS at /<comp>/rss.xml
worker/entrypoint.ts       Astro custom Worker + Cron + Queue handlers
worker/index.ts            legacy API bridge and /api/explore dispatcher
migrations/                D1 SQL migrations
wrangler.jsonc             D1/KV/Queue/DO/Cron/Assets bindings
```

## 本地开发

要求 Bun `1.3.14`：

```bash
bun install
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填写 GEMINI_API_KEY

bunx wrangler d1 migrations apply umuo-content --local
bun run dev
```

常用检查：

```bash
bun run typecheck
bunx vitest run
bun run lint
bun run format:check
bun run build
bunx wrangler deploy --dry-run --outdir=.wrangler/dry-run
```

本地迁移会创建 `.wrangler/state` 下的 D1 数据库。没有 Gemini key 时页面仍能启动，但 D1 不会产生新的 AI 文章；Queue 消费会按失败策略重试。

## Cloudflare 部署

首次部署需要准备 D1 和两个 Queue：

```bash
bunx wrangler d1 create umuo-content
bunx wrangler queues create umuo-news-ingest
bunx wrangler queues create umuo-news-ingest-dlq
```

把 D1 返回的 `database_id` 补进 `wrangler.jsonc` 的 `d1_databases`，然后执行：

```bash
bunx wrangler d1 migrations apply umuo-content --remote
bunx wrangler secret put GEMINI_API_KEY
bunx wrangler types
bun run build
bunx wrangler deploy
```

生产部署后由 Cron 自动开始抓取。可以在 Cloudflare Dashboard 的 Queues、D1 和 Worker Logs 中分别观察积压、写入量、死信和 Gemini/源站错误。

## 设计约束

- LLM 输出使用 Gemini Interactions API 的 JSON schema，并在 Worker 内再次用 Zod 校验。
- 所有 D1 查询使用 prepared statements；批量写入使用 D1 `batch()`。
- 文章只会在 AI 判定 `isFootball=true` 时进入 `published`，非足球内容写入 D1 的 `filtered` 状态，便于审计和调参。
- URL 去掉追踪参数，文章以 canonical URL 和 SHA-256 fingerprint 双重去重。
- Gemini、源站或 D1 临时异常不会让 SSR 页面崩溃；Explore 无可用 D1 数据时显示空态，兼容的旧 ESPN API 继续使用 KV stale fallback。
- 生产代码只依赖 Web/Workers API，不依赖 Node 或 Bun runtime API。
