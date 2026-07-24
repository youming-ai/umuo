# 多体育扩展设计（方向 A：渐进式适配器）

> 状态：设计待评审
> 日期：2026-06-30
> 背景：umuo 当前是 2026 世界杯单赛事 SPA（`fifa.world` 写死）。目标是在**同一个 App + 同一套部署**里加赛事切换器，逐步支持其他足球联赛和其他运动（NBA/NFL/MLB/NHL）。数据全部来自 ESPN 隐藏 API（见 `docs/espn-api.md`）。

---

## 1. 目标与范围

- 一个 App、一套部署，顶部加**赛事切换器**；世界杯与其他赛事共存。
- 赛事进 URL 首段：`/<key>/...`（如 `/fifa.world/standings`、`/nba/match/<slug>`），保住「每个视图可深链分享」这一核心价值。
- 数据接入沿用现有 Worker 边缘缓存 + dev proxy 模式，只做参数化。
- **跨运动的归一化抽象延迟到第二个真实样本（NBA）再提取**，避免凭世界杯单样本抽错。

## 2. 非目标（YAGNI — 明确不做）

- **不**现在就定义通用 `SportAdapter` 接口。Phase 1-2 只把世界杯重构成「适配器 #1」，接口形状等 Phase 3 写 NBA 时从两者共性提取。
- **不**做大一统数据模型（方向 B 已否决）。
- **不**为还没上线的运动预先建视图变体。视图按 `capabilities` 标志显隐，需要时再加变体。
- **不**改动直播流（ppv.to / `useStreams` / `streamMatch`）的现有架构——它浏览器直连、与 ESPN 解耦，本期保持原样，仅在切换器层面跟随当前赛事。

## 3. 架构

### 3.1 Competition 配置表（新增，Phase 1 落地）

静态注册表，切换器和路由的单一事实源。

```ts
type Sport = 'soccer' | 'basketball' | 'football' | 'baseball' | 'hockey';

type Competition = {
  key: string;             // URL 首段，如 'fifa.world' | 'eng.1' | 'nba'
  sport: Sport;            // ESPN {sport}
  league: string;          // ESPN {league} slug
  label: string;           // i18n key
  season: number;
  dates?: string;          // scoreboard 日期窗（锦标赛需要，赛季制可省）
  standingsLevel?: number; // soccer 用（世界杯=3 取分组表）
  shape: 'tournament' | 'season';
  capabilities: {
    bracket: boolean;      // 淘汰赛图
    scorers: boolean;      // 射手榜（soccer）
    leaders: boolean;      // 通用 stat leaders（其他运动）
    lineups: boolean;      // 阵容图（soccer pitch）
    boxscore: boolean;     // 球员 box score（篮球等）
  };
};
```

首期注册表只放 `fifa.world` 一条（行为等价现状）。`featured` / 默认赛事单独标记，供根路由使用。

### 3.2 URL 方案：首段路径

| 路由 | 说明 |
|---|---|
| `/` | 重定向到默认（featured）赛事首页；后续可换成赛事选择页 |
| `/<key>` | 该赛事首页（赛程） |
| `/<key>/standings` | 积分榜 / 排名 |
| `/<key>/scorers` 或 `/<key>/leaders` | 按 capabilities 二选一 |
| `/<key>/bracket` | 仅 `shape: tournament` 时存在 |
| `/<key>/match/<slug>` `/<key>/team/<id>` `/<key>/player/<id>` | 同现状，加赛事前缀 |
| `/<key>/live` `/<key>/live/<slug>` | 直播，跟随当前赛事 |

- `parseRoute`：解析首段为 competition key，查注册表；非法 key → 回落默认赛事（不 throw，沿用现有 `safeDecode` + 兜底首页的纪律）。
- `pathFor` / `navigate` / `Route` union：全部带上 `key`。**这是机械改动最大的一块**——每个内部链接都要带当前赛事 key。
- **向后兼容**：已分享的旧链接（无赛事前缀，如 `/standings`、`/match/<slug>`）→ 重定向到 `/fifa.world/<same>`。在 `parseRoute` 里识别「首段是已知视图名而非已知 competition key」的情况，重写为默认赛事路径。

### 3.3 Worker / dev proxy 参数化（Phase 1）

- `worker/index.ts`：`SOURCES` 不再写死 URL，改为 `buildUrl(competition, resource)` 按注册表拼接（scoreboard / standings / summary）。同源路由 `/api/wc/*` → `/api/<key>/<resource>`。`fresh`/`keep` TTL 可按 resource 给默认值，必要时按赛事覆写。
- `vite.config.ts`：rewrite 用**同一个 `buildUrl` 纯函数**（抽到一个无依赖模块，Worker 和 vite 共享），杜绝两边漂移。注册表也需对 dev 可见。
- 缓存键、coalescing、serve-stale、伪装 UA 全部不变。

### 3.4 视图按 capabilities 驱动

`App.tsx` 从路由拿当前 competition，渲染切换器，并据 `capabilities` 决定导航项与页面：

- `bracket: false` → 不显示淘汰赛 tab/页。
- `scorers` vs `leaders` → 决定第三个数据 tab 是射手榜还是通用榜。
- `lineups` vs `boxscore` → 决定 match detail 页用足球阵型图还是球员数据表。

### 3.5 适配器契约：延迟提取

- **Phase 2**：`useWorldCup` → `useCompetition(key)`。它读注册表，调 `/api/<key>/*`，再用「该 sport 的 transform」解析。首期只有 soccer transform（就是现在 `useWorldCup` + `espn.ts` 里的逻辑搬过去）。
- **Phase 3**：写 NBA 的 transform 时，对照 soccer 提取 `SportAdapter` 契约：
  ```ts
  type SportAdapter = {
    transformScoreboard(json): Match[];
    transformStandings(json): StandingsTable[];  // 分组 or 单表 or 分区
    transformSummary(json): MatchDetail;
  };
  ```
  契约的真实字段以两个样本的共性为准，不在 Phase 1 预设。

## 4. 与世界杯硬耦合的点 → 重构去向

| # | 现状位置 | 去向 |
|---|---|---|
| 1 | `worker/index.ts` `SOURCES`/`ROUTES` 写死 fifa.world | `buildUrl(competition, resource)` + `/api/<key>/*` |
| 2 | `vite.config.ts` rewrite 写死 URL | 共享 `buildUrl` 纯函数 |
| 3 | `src/hooks/useWorldCup.ts` 大转换 | `useCompetition(key)` + soccer adapter transform |
| 4 | `src/types/index.ts` `WC*`/`TopScorer`/`MatchDetail` | 首期保留为 soccer 形状；Phase 3 泛化命名 |
| 5 | `src/utils/wc.ts` stage/sortStandings 等 | soccer 专属移入 soccer adapter；通用 status/score 留共享 |
| 6 | `src/utils/espn.ts` `parseSummary`（足球阵容） | soccer adapter 的 detail transform |
| 7 | `src/utils/router.ts` 路由 | Route union/parseRoute/pathFor 加 competition 首段 + 旧链接重定向 |
| 8 | `App.tsx` 开关 | 从路由派生 competition；渲染切换器；按 capabilities 门控 |
| 9 | `src/i18n/messages.ts` | 赛事名 + 按运动的视图标签（保持四语 key 对齐，`messages.test.ts` 把关） |
| 10 | `src/hooks/useBracket.ts` | 仅 `capabilities.bracket` 时启用 |

新增文件：`src/competitions.ts`（注册表 + `buildUrl`）、切换器组件、（Phase 3）`src/adapters/`。

## 5. 分步落地

每个 Phase 独立可上线、可验证（`npm run typecheck` + `npx vitest run` + 关键路径手测）。

- **Phase 1 — 配置 + 接入参数化（无行为变化）**
  新增注册表（仅 fifa.world）+ `buildUrl`；Worker 路由改 `/api/<key>/*`；dev proxy 同步；前端调用点改用 key。验证：世界杯一切如旧，`/api/fifa.world/scoreboard` 通。
- **Phase 2 — 路由带赛事 + capabilities 门控**
  router 加首段 + 旧链接重定向；`useWorldCup`→`useCompetition`；切换器组件（此时只有一个选项）；视图读 capabilities。验证：所有页面在 `/fifa.world/*` 下工作，旧链接重定向正常，深链分享不破。
- **Phase 3 — 加第二个赛事并提取契约**
  先加一个**同为足球的赛季制赛事**（如 `eng.1`）验证 shape='season' 分支（无 bracket、单表积分榜）；再加 **NBA** 引入跨运动，借此提取 `SportAdapter` 契约、拆分 leaders/boxscore 视图变体。验证：切换器在三个赛事间切换，各视图正确显隐。
- **Phase 4 — 沉淀**
  之后每个新赛事 = 注册表一行 +（新运动才需要）一个 adapter + 可能的视图变体。

> 注：Phase 3 故意先上「赛季制足球」再上「跨运动」——用低成本样本先验证 season/tournament 分叉，再用高成本样本验证跨运动分叉，接缝暴露得更干净。

## 6. 风险 / 待定

- **旧深链兼容**：上线 Phase 2 时，已在外流传的 `/standings` 等无前缀链接必须重定向到 `/fifa.world/*`，否则 404。已在 §3.2 设计进 `parseRoute`。
- **ESPN standings 形态差异**：世界杯=分组（`children[]`），赛季制足球=单表，NBA=分区/会议。`transformStandings` 返回类型需容纳「一到多张表」。这是 Phase 3 提取契约时的主要张力点。
- **抽象时机**：契约必须等 NBA 落地再定。若 Phase 3 前就有人想提前抽 `SportAdapter`，明确拒绝（YAGNI）。
- **i18n 膨胀**：跨运动术语（节/局/半场、各类统计项）会显著增加 key；四语对齐由 `messages.test.ts` 保证，但维护成本上升。
