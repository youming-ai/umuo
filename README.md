# StreamCup — 体育赛事数据与直播导航系统

StreamCup 是一个高性能、轻量级的体育赛事数据追踪与在线直播导航 Web 系统，支持世界杯（FIFA World Cup）、英超（Premier League）以及 NBA 等多项赛事，并内置赛事资讯（News）流。系统基于 **Astro 7 服务端渲染（SSR）+ React 群岛（Islands）** 架构，整站以单个 Cloudflare Worker 部署，边缘节点同时负责页面渲染与上游数据源的 KV 缓存代理，提供极致平滑的交互体验与可靠的数据兜底。

---

## 1. 系统架构与数据流

本系统是一个部署在 Cloudflare 边缘的 Astro SSR 应用：Astro 页面在服务端完成首屏渲染并注入初始数据（seed），React 群岛在浏览器水合后接管交互与轮询；共享数据层（`src/data/api.ts`）统一承担 KV 缓存、请求合并与陈旧兜底，被 SSR 页面与 `/api/*` Worker 包装层共用。

```mermaid
graph TD
  User([用户浏览器]) -->|页面请求| Astro[Astro SSR 页面]
  Astro -->|服务端注入初始数据| Layer[共享数据层 src/data/api.ts]
  User -->|同源 API: /api/:comp/:resource| Route[api/[...route].ts → worker/index.ts]
  Route --> Layer
  Layer -->|KV 缓存 + 请求合并| KV[(Cloudflare KV 缓存)]
  Layer -->|上游故障时下发陈旧副本| ESPN[ESPN 官方数据源]
  Astro -->|initialData| Island[React 群岛 client:only]
  Island -->|可见性感知 SWR 轮询| Route
  User -->|浏览器直连获取直播流| Stream[ppv.st / embedindia.st / vileembeds]
```

### 1.1 Astro SSR 外壳与 React 群岛
* **技术栈**：Astro 7（`output: "server"`）、`@astrojs/cloudflare` v14 适配器（本地开发由适配器经 wrangler/miniflare 提供真实 KV 绑定，无 `platformProxy` 字段）、`@astrojs/react`（群岛）、Tailwind CSS 3、Biome。
* **两段式渲染**：`src/pages/` 下的 Astro 文件式路由在服务端通过共享数据层（`cloudflare:workers` 的 `env` + `Astro.locals.cfContext` 的 `ctx`）拉取初始数据、渲染首屏，再把数据作为 `initialData` 传给以 `client:only="react"` 挂载的 React 群岛。群岛水合后用初始数据 seed 各自的 Hook，接管后续交互与轮询。`AppProviders.tsx` 为每个群岛注入主题上下文。
* **数据轮询与 SWR**：前端数据 Hook（`useCompetition`、`useMatchDetail`、`useLeaders`、`useBracket`、`useStreams`、`useNews`）均支持可见性感知（Page Visibility API）——标签页后台时暂停轮询，返回前台立即静默刷新——并统一以 `AbortController` 取消在途请求避免竞态。

### 1.2 路由分层：Astro 管入口，自定义路由管站内跳转
* **Astro 中间件**（`src/middleware.ts`）：每次请求都会运行，将 `/` 与遗留的无赛事前缀路径 307 重定向到默认赛事 `/<DEFAULT_COMPETITION>`（`fifa.world`）；带赛事前缀的路由、`/api` 及静态资源路径原样放行，遗留 `/scorers` slug（含 `/<comp>/scorers`）307 跳转到 `/<comp>/stats`。
* **文件式路由**：`[comp]/{index,news,stats,bracket,transactions,odds,teams}`、`[comp]/match/[slug]`、`[comp]/team/[id]`、`[comp]/player/[id]`、`api/[...route]`、`sitemap.xml.ts`。（无全局 `/news`，也无顶层 `/player`。）
* **站内客户端路由**：`src/utils/router.ts` 是一个极薄的纯 URL 构造/读取工具——`Route` 联合类型、`parseRoute`/`pathFor`，以及 `navigate()`（真实 `window.location` 跳转，**非** pushState——客户端路由器已移除，每个视图都是独立的 SSR 文档）。每条路由都以赛事 key 作为 URL 首段；`useRouter()` 仅解析 `window.location.pathname`（无订阅，跳转即整页重载）。路径参数视为不可信输入，用 `safeDecode` 防御式解码以避免 `URIError`。

### 1.3 共享数据层与边缘 Worker 包装
* **共享数据层**（`src/data/api.ts`）：KV 缓存 + 请求合并 + 陈旧兜底的核心逻辑与 SSR 组合函数集中于此，保证只有一条缓存路径。
  * **边缘 TTL / SWR 缓存**：在 Cloudflare KV 中存储原始 JSON，按资源类型配置 `fresh`/`keep` 两级 TTL（Scoreboard、Standings、Summary、Leaders、News 各有窗口；`keep` 统一约 1 天）。`fresh` 窗口内直接命中返回，过期后同步向上游 revalidate。注意：**Worker 层是"TTL 缓存 + 陈旧兜底"，"先返回陈旧、后台异步刷新"的完整 SWR 语义在前端 Hook 层（§1.1）。**
  * **并发请求合并（Request Coalescing）**：用模块级内存 `Map` 对同一端点的在途请求做惊群保护，`fresh` 过期瞬间的并发只触发一次上游 Fetch，其余搭车共享同一份 JSON 载荷（各自再构造独立 `Response`）。注意：`workerd` 每节点多个 V8 isolate 且**内存互不共享**，故合并仅在**单个 isolate 内**生效；真正把上游流量压到最低的是 KV `fresh` 缓存窗口，合并只是边界上的补充优化。
  * **容灾降级（Serve-Stale）**：上游 ESPN 发生错误时自动后台重试；彻底不可用时直接下发 KV 中已过期的 STALE 副本，仅在毫无缓存时才返回错误。
  * **SSR 组合函数**：`getCompetitionView`（scoreboard + standings + 适配器 → 可直接渲染的视图）、`getLeaderboards`（Stats 页）、`getCompMatchBySlug`、`getMatchSummary`、`getCompNews`、`getTeams`、`getTeamDetail`、`getTransactions`、`getLeagueInjuries`——供 Astro 页面服务端直接调用；群岛则走同源 `/api/*`。
* **Worker 包装层**（`worker/index.ts`）：极薄的 HTTP 分发层——解析 URL → 分发到 `serve*`（`/api/<comp>/(scoreboard|standings|summary|leaders|news)`；未知赛事 404）。在 Astro 部署中由 catch-all 路由 `src/pages/api/[...route].ts` 转发 `worker.fetch(request, env, ctx)` 挂载在 `/api/*`；其余请求（SSR 页面 + `dist/` 静态资源）由 Astro 自身处理。

### 1.4 已知约束与运营注意事项
以下是架构固有的约束与需要在部署侧处理的事项，代码无法单独消除，特此记录并给出处置建议：

* **数据源单点依赖**：全部赛事与资讯数据依赖 ESPN 的**非官方 site/core API**（无契约、无 SLA，结构随时可能变更）。代码用防御式 `obj()/arr()/str()` 解析吸收字段漂移，但整体不可用时只能靠 `keep`（约 1 天）内的 STALE 缓存兜底。**建议**：监控上游可用性；关键赛事期间可临时拉长 `keep`。
* **直播源脆弱性**：直播依赖第三方聚合站（当前 `ppv.st` / `embedindia.st` / `vileembeds.pages.dev`），受法律与可用性双重影响 —— 前身 `ppv.to` 已于 2026-07 被执法查封。系统仅通过 `isTrustedStreamUrl` 白名单在渲染 iframe 前做安全隔离（HTTPS + 受信主机，防 XSS/恶意重定向），但**源本身不受控**，随时可能失效。切换新源时更新 `src/utils/streamSources.ts` 白名单。
* **公开 API 无鉴权 / 需在边缘侧限流**：`/api/:comp/:resource` 与 `/api/news` 完全公开，KV 缓存保护了 ESPN 上游，但**不保护 Worker 自身**——端点可被高频刷取，消耗 Cloudflare 请求与 KV 读额度。**建议**：在 Cloudflare 控制台配置 **Rate Limiting Rules / WAF**（按客户端 IP 限流）；不建议在应用代码内做 Referer 校验（易伪造、且会误伤合法用户，属于虚假安全感）。
* **KV 写入额度与成本**：`fresh` 过期触发的 revalidate 会写一次 KV（`at` 时间戳必须刷新以维持缓存窗口，故无法靠"内容去重"省写）。高流量下 Scoreboard 单键每天最多写上千次，叠加多赛事/多资源后**很容易超出 KV 免费层 1000 writes/day**。**建议**：按实际流量评估，必要时拉长 `fresh`（牺牲实时性换写入量）或启用 KV 付费层。

---

## 2. 核心功能模块

### 2.1 赛事切换与多运动数据适配层 (SportAdapter System)
* **动态赛事切换**：支持世界杯（`fifa.world`）、英超（`eng.1`）和 NBA（`nba`）。系统读取 `src/competitions.ts` 作为**单一事实源**（纯数据 + 纯函数 `buildUrl()`，无 DOM/React 依赖，可在 app 与 worker 两套 tsconfig 下编译），所有消费方（Astro 页面、Worker 包装层、切换器）都从它构造 ESPN URL，永不漂移。
* **数据归一化**：定义统一的 `SportAdapter` 接口（`src/adapters/types.ts`），由 `soccer.ts`（足球）和 `basketball.ts`（篮球）实现，经 `getAdapter(comp)` 注册。将 raw ESPN JSON 归一化为共享数据模型（`CompMatch[]` / `StandingsData` / `MatchDetail`，后两者是基于 `kind` 的**判别联合**，视图按判别式分支）。
* **动态赛季推导**：`seasonForDate` 无硬编码推导赛季（足球以 8 月为起始年分界，篮球以 10 月为结束年分界），防止写死年份导致数据过期。

### 2.2 赛程对阵看板 (Fixtures & Schedule Dashboard)
* **智能赛程分组**：按开球日期聚合比赛，未完赛/进行中的按时间正序、已完赛的按时间倒序排列（最近结束优先）。
* **粗/细粒度过滤**：支持"未完赛"与"已结束"分类并实时显示计数；杯赛制（World Cup）支持小组赛、1/16、1/8、1/4、半决赛、三四名、决赛等多阶段过滤。
* **日历提醒订阅**：针对未开赛比赛提供原生 `.ics` 系统日历导出（转义处理防格式损坏）与 Google Calendar 提醒链接。

### 2.3 积分榜与淘汰赛对阵图 (Standings & Bracket)
* **足球积分榜**：展示各小组/联赛球队的"已赛、胜、平、负、净胜球、积分、近况（最近5场）"，并按出线规则高亮。
* **篮球分区榜**：为 NBA 适配 ConferenceStandings，展示东/西部"胜、负、胜率、胜差"。
* **对称淘汰赛对阵图**：为杯赛淘汰赛提供基于 SVG 连接线的树状对阵图，左右半区对称汇聚至决赛，支持点击跳转到具体比赛详情。

### 2.4 比赛详情与精细数据页签 (Match Detail Pages)
* **实时状态追踪**：未开赛、直播中（比分、时钟、中场）、已结束（完赛、加时、点球大战）的状态徽章。
* **多维度数据页签**：
  * **足球**：数据（控球、射门、犯规、黄红牌）、进程（Play-by-Play，区分"全部/关键"）、阵容（首发/替补，可点开单球员本场数据）。
  * **篮球**：Boxscore（各节比分 + 两队球员技术统计）、数据（快攻/内线/失误得分对比）。

### 2.5 球队与球员档案页
* **球队详情页**：球队徽章、当前组别，分类聚合"未完赛/已完赛（倒序）"记录及队内最佳射手榜。
* **球员详情页**：基本信息、国籍/球队背景，并自动遍历全部比赛提取该球员的进球记录与时间戳。

### 2.6 安全多线路直播流播放器 (Live Streaming Player)
* **直播源跨源匹配**：通过 Team-name slug 对比（`src/utils/streamMatch.ts`）将 ESPN 赛程与外部直播源 API 模糊匹配，匹配成功即呈现"直播中/观看"入口。直播流由**浏览器直连**获取（`useStreams.ts`），绕过 Worker（聚合站会封禁数据中心 IP）。
* **安全域白名单校验**：渲染 iframe 前用 `isTrustedStreamUrl` 做严格 HTTPS + 主机白名单匹配，屏蔽非受信源，防御 XSS 与恶意重定向。
* **多线路切换与状态感知**：内置线路切换菜单，加载时渲染动画遮罩，信号丢失时提供 Standby（待机）与恢复机制。

### 2.7 赛事资讯流 (News Feed)
* **按赛事资讯**：接入 ESPN site.api 的按联赛新闻流（`site/v2/.../{league}/news`，真正按联赛限定——旧的全局"now"消防栓已移除）。`src/newsFeed.ts` 的 `parseNewsFeed` 将上游归一化为 `NewsItem[]`；`src/data/api.ts` 的 `getCompNews` 组合 `serve(news)` + 解析，任一失败返回空数组。
* **SSR + 群岛**：`[comp]/news` 页面服务端用 `getCompNews` 拉取（组合 `serve(news)` + `parseNewsFeed`，任一失败返回空数组）并由 Astro SSR 渲染首屏，随后 `NewsIsland` + `NewsView` + `useNews.ts` 客端接管刷新（120s 可见性轮询、滚动加载更多）。顶部粘性栏的 `Ticker` 群岛（由模块级共享轮询器 `useTicker` 驱动，展示正在直播与即将开赛的比赛）独立于资讯流。
* 分类规则详见 `docs/news-classification-spec.md`。

### 2.8 主题切换 (Theme)
* **系统级主题切换**：Light/Dark 主题，`src/theme/` 提供 `ThemeProvider`/`useTheme`（持久化于 `localStorage`，默认 dark）。`Layout.astro` 内联脚本在水合前设置 `data-theme` 避免闪烁；界面采用玻璃拟态卡片设计（Rounded Glassmorphism，比例圆角，Apple Sports 风格）。（UI 文案为英文硬编码——国际化已在重构中移除。）

---

## 3. 本地开发与构建指令

### 3.1 基础配置
* **本地工具链**：Bun（依赖安装、dev、build、test；lockfile `bun.lock`）。注意：**Bun 只是本地工具链，不是生产运行时** —— 生产代码运行在 Cloudflare Workers 的 `workerd`（V8 isolate）上，受其约束（无 Node/Bun API、无持久共享内存、有 CPU 时间与子请求上限）。这也是 §1.3 "内存 Map 合并仅限单 isolate"的根本原因。
* **依赖安装**：
  ```bash
  bun install
  ```

### 3.2 常用指令
* **本地开发服务**（`astro dev`，默认端口 `4321`；`platformProxy` 提供本地真实 KV，`/api/*` 与 SSR 均走生产缓存路径）：
  ```bash
  bun run dev
  ```
* **生产环境打包**（`astro check` + Worker 类型检查 + `astro build`，产出 `dist/` 静态资源与 `dist/_worker.js/` SSR Worker）：
  ```bash
  bun run build
  ```
* **本地预览打包产物**：
  ```bash
  bun run preview
  ```
* **运行单元测试**（Vitest；jsdom 环境，Worker 测试用 `// @vitest-environment node` 头部；`fileParallelism: false` 串行执行）：
  ```bash
  bun run test          # watch 模式
  bunx vitest run       # 单次 CI 模式
  ```
* **静态检查与格式化**：
  ```bash
  bun run typecheck   # astro check（app+worker，DOM 严格）+ tsc -p tsconfig.worker.json（worker，无 DOM 的 workerd lib）
  bun run lint        # Biome 代码检查（lint:fix 自动修复）
  bun run format      # Biome 自动格式化（format:check 仅校验）
  ```

> 无 `deploy` 脚本，`wrangler` 也不是依赖 —— 部署在仓库外进行（CI / Cloudflare Git 集成），配置见 `wrangler.jsonc`。

---

## 4. 目录结构

```
├── astro.config.mjs      # Astro SSR + Cloudflare 适配器 + React 群岛集成
├── wrangler.jsonc        # Cloudflare Worker (dist/_worker.js) + ASSETS + CACHE KV
├── vitest.config.ts      # Vitest（jsdom / 串行）配置
├── docs/                 # espn-api.md（上游端点与坑）、news-classification-spec.md、superpowers/（规范与计划）
├── design-tokens/        # 设计变量 (tokens.json)
├── public/               # PWA 清单、图标、og.jpg、sw.js（生产环境中由 Layout.astro 注册）
├── src/
│   ├── pages/            # Astro 文件式 SSR 路由
│   │   ├── [comp]/       # index / news / stats / bracket / transactions / odds / teams / match/[slug] / team/[id] / player/[id]
│   │   └── api/[...route].ts   # 将 /api/* 转发给 worker/index.ts
│   ├── layouts/          # Layout.astro（外壳：Ticker / Header / 左右栏 / Footer）
│   ├── components/       # *.astro 外壳 + React 视图 + *Island.tsx 水合包装 + AppProviders
│   │   └── matchdetail/  # 比赛详情页内部 Tabs
│   ├── data/api.ts       # 共享 KV 缓存 + SSR 组合函数
│   ├── middleware.ts     # 规范化路径重定向
│   ├── adapters/         # 体育数据适配归一化层 (types / soccer / basketball / index)
│   ├── hooks/            # 自定义 React Hooks（SWR + 可见性轮询）
│   ├── theme/            # 主题 Provider（ThemeProvider/useTheme，dark/light）
│   ├── utils/            # router / calendar / marquee / streamMatch / espn / wc / streamSources ...
│   ├── competitions.ts   # 赛事注册表（单一事实源）
│   ├── leaders.ts        # assembleLeaders 服务端聚合管线
│   ├── news.ts  newsFeed.ts   # 资讯参数与 feed 解析
│   └── types/            # 共享类型
└── worker/               # index.ts（/api/* HTTP 包装层）+ 单元测试
```
