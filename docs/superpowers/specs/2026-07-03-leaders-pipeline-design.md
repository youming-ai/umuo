# Leaders 管道设计：赛季射手/得分榜（英超 + NBA）

> 状态：设计已获批
> 日期：2026-07-03
> 前置：Phases 1–3b + 化妆清理（PR #34）。分支 `feat/leaders-pipeline` 栈式基于 `chore/phase3b-cleanup`。
> 背景：世界杯射手榜已从 scoreboard 的 `competitor.leaders` 聚合可用；但英超 scoreboard 不带每队 leaders、NBA 需要赛季得分榜——这两个赛事的榜单当前被 capabilities 隐藏。本设计补齐它们。

## 1. 目标与范围

为「scoreboard 不带 leaders」的赛事（**英超 `eng.1`** 射手榜、**NBA `nba`** 得分榜）提供赛季榜单，经一条服务端聚合管道。世界杯行为不变。

**加法式**（已定）：世界杯保留现有 scoreboard 聚合路径不动；管道只服务 eng.1 + nba。
**单类别**（已定）：NBA 只做得分榜（points），与足球射手榜（goals）对称——每赛事一个 `Leader[]`。

## 2. 非目标（YAGNI）

- **不做** NBA 多类别（篮板/助攻）榜——单得分榜；多类别留后续。
- **不改**世界杯 scorers 的数据来源（仍是 scoreboard 聚合）。
- **不做**球员详情跳转（榜单行点击进球员页）——现有球员页是足球形状，NBA 球员页是独立后续项。榜单行**不可点击**。
- **不做** dev 环境的缓存（dev 中间件每次实算；缓存是 prod/Worker 的事）。

## 3. 探测事实（2026-07-03 实测 ESPN core API）

- 端点：`https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/seasons/{season}/types/{type}/leaders`
  - soccer `eng.1`：`type=1`，类别 `goals`（25 条）。
  - basketball `nba`：`type=2`（regular season；`type=1` 空），类别 `points`（25 条）。
- 每条 leader：`{ displayValue: string, value: number, athlete: {$ref}, team: {$ref}, statistics: {$ref} }`——**无内联名字**。
- `athlete.$ref` → `{ displayName: "Erling Haaland", shortName: "E. Haaland" }`。
- `team.$ref` → `{ displayName: "Manchester City", logos: [{ href }] }`。
- season 键沿用 `seasonForDate(sport, now)`（Phase 3b）：soccer 起始年/8 月翻转，basketball 结束年/10 月翻转。

## 4. 架构

### 4.1 统一展示模型（`src/types/index.ts`）
```ts
interface Leader {
  rank: number;       // 1-based，按 value 降序
  name: string;       // athlete displayName
  teamName: string;
  teamLogo: string;   // '' if unknown
  displayValue: string; // ESPN 原样格式（"27" / "30.2"）——回避 总数 vs 场均
  value: number;      // 排序用
}
```
世界杯的 `TopScorer[]`（scoreboard 来源，保留）在调用点映射成 `Leader[]`（`rank=i+1`, `teamLogo=teamFlag`, `displayValue=String(goals)`, `value=goals`）——WC 数据路径零改动，只归一化渲染输入。

### 4.2 共享聚合器（新 `src/leaders.ts`，纯函数、无 DOM/React；worker 与 vite 中间件共用，延续 `buildUrl` 共享纪律）
```ts
interface LeadersConfig {
  sport: string; league: string; season: number;
  type: number;      // soccer 1 / basketball 2
  category: string;  // 'goals' / 'points'
  topN: number;      // 15
}
// fetchImpl 注入（Worker 传 global fetch；dev 中间件传 node fetch）→ 便于单测传假实现
async function assembleLeaders(fetchImpl: typeof fetch, cfg: LeadersConfig): Promise<Leader[]>
```
流程：拉 leaders URL → 取 `categories` 里 name===cfg.category 的 `leaders` → 截 top N → 收集去重后的 athlete + team `$ref` → **并发上限 ~10** 解析（team 去重后通常 ~8–10 个）→ 组装 `Leader[]`，按 value 降序、`rank` 从 1。防御性解析（`obj()/arr()/str()` 房屋风格）；任何 ref 解析失败该行降级（name/teamName 空串），不 throw；子请求总数 ≤ ~25，远低于 CF Workers 的 50 上限。

per-sport 的 `{ type, category }` 小映射放 `src/leaders.ts`（与 `assembleLeaders` 同处）：`LEADERS_BY_SPORT: Record<Sport, { type: number; category: string }> = { soccer: { type:1, category:'goals' }, basketball: { type:2, category:'points' } }`（其它 sport 暂缺，有赛事再加）。

### 4.3 Worker（`worker/index.ts`）
- 新路由 `/api/<key>/leaders`：查 `COMPETITIONS[key]` → 组 `LeadersConfig`（season=`seasonForDate(sport, new Date())`，type/category 按 sport）→ 经**新增** `cachedProducer(cacheKey, producer, fresh, keep, env, ctx)` 缓存 `assembleLeaders(fetch, cfg)` 的**结果**（现有 `cached()` 只缓单 URL 抓取；`cachedProducer` 缓任意 async producer 的产物，复用同一 KV/coalescing/serve-stale 语义）。TTL：fresh 3600、keep 86400（赛季统计变化慢）。
- 未知 key → 404（沿用 `Object.hasOwn` 守卫）。

### 4.4 Vite dev 中间件（`vite.config.ts`）
`server.configureServer`（或等价 plugin hook）拦截 `/api/<key>/leaders`：查注册表 → 组同一 `LeadersConfig` → `await assembleLeaders(globalThis.fetch, cfg)` → 写 JSON 响应。dev 不缓存。与 Worker 走**同一** `assembleLeaders`，无第二实现、无漂移。

### 4.5 前端
- `src/hooks/useLeaders.ts`：`useLeaders(comp: string) → { leaders: Leader[], loading, error }`。SWR + 可见性门控轮询（沿用 useStreams 模式，间隔 60s+）+ AbortController。仅当 `leadersSource==='pipeline'` 时调用（WC 不调）。
- `src/components/LeadersView.tsx`：`TopScorersView` 泛化而来——渲染 `Leader[]` 排名列表（名次、队徽、球员名、球队、`displayValue`）。**行不可点击**。列头/tab 标签按 sport（足球「射手榜」+ 「进球」；篮球「得分榜」+ 「得分」）。
- `FixturesView` scorers/leaders tab：按 `leadersSource` 分叉——`scoreboard`（WC）用 `useCompetition().scorers` 映射；`pipeline`（eng.1/nba）用 `useLeaders(comp)`。两者都渲染 `LeadersView`。

### 4.6 注册表 + capabilities（`src/competitions.ts`）
- 新字段 `leadersSource?: 'scoreboard' | 'pipeline'`：fifa.world='scoreboard'，eng.1='pipeline'，nba='pipeline'。
- 打开 tab：eng.1 与 nba 的 `capabilities.scorers` 由 false → **true**（Header tab 门控已读 `scorers`）。
- **删除** `capabilities.leaders` 死字段（Phase 1 预留、从未被读；本设计用 `scorers`+`leadersSource` 表达）。
- fifa.world 的 `scorers` 保持 true、`leadersSource='scoreboard'`。

### 4.7 i18n（`src/i18n/messages.ts`）
新 key ×4 语言：篮球 tab 标签 `fixtures.leaders`（"Scoring Leaders"/「得分榜」…）、统计列头 `leaders.goals`/`leaders.points`（或复用现有）。足球射手榜文案复用现有。`messages.test.ts` 把关。

## 5. 数据流
`route.comp` → `COMPETITIONS[comp].leadersSource` 决定 scorers tab 数据源。pipeline 侧：`useLeaders` → `/api/<comp>/leaders` → Worker `cachedProducer` → `assembleLeaders(fetch, cfg)` → core API leaders + ref 扇出 → `Leader[]`。dev 侧同一 `assembleLeaders` 经中间件。scoreboard 侧（WC）：`useCompetition().scorers`（TopScorer[]）映射为 `Leader[]`。

## 6. 测试
- `assembleLeaders`（`src/leaders.test.ts`）：注入假 `fetchImpl`，按 URL 返回 canned leaders 载荷 + 各 athlete/team ref 载荷（**零网络**）；断言排名降序、rank 从 1、名字/队徽解析、team ref 去重、topN 截断、缺失 ref 降级不 throw、类别选择正确。
- `seasonForDate` 已测（Phase 3b）。
- Worker leaders 路由（`worker/index.test.ts`）：fetch mock → `cachedProducer` 命中/MISS/STALE 语义；未知 key 404。
- `useLeaders`（fetch mock）；`LeadersView` 渲染（行不可点击）；`FixturesView` 按 `leadersSource` 分叉（WC 映射路径 vs pipeline 路径）。
- dev 中间件不单测（靠 `assembleLeaders` 单测 + 手测）。
- 全量 typecheck（app+worker）+ lint + `npx vitest run`。

## 7. 风险 / 待定
- **core.api 从 CF Worker 可达性**：ESPN 一般不封数据中心 IP（只 ppv.to 封），但 leaders 是首个 Worker→core.api 调用，需在 Cloudflare preview 验证一次。
- **子请求上限**：topN=15 + 去重 team → ~25 子请求 < 50（免费档）。若某类别 team 分散导致逼近上限，降 topN 或先只解析 athlete、team 复用 standings map（后续优化，非首版）。
- **dev 中间件契合 Vite plugin API**：`configureServer` 中间件写 JSON 响应的确切写法需按 Vite 版本核对（plan 期验证）。
- **season 交替期空数据**：off-season 某赛季 leaders 可能空——空态处理（榜单为空显示空态）。
- **`cachedProducer` 与现有 `cached` 的去重**：二者共享 KV/coalescing 机制，实现时把公共部分抽出，避免两份缓存逻辑漂移。
