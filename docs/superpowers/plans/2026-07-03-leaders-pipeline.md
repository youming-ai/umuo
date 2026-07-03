# Leaders 管道实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「scoreboard 不带 leaders」的赛事补齐赛季榜单——英超 `eng.1` 射手榜（goals）、NBA `nba` 得分榜（points）——经一条服务端聚合管道（core.api leaders 端点 + athlete/team `$ref` 扇出 → 统一 `Leader[]`）。世界杯 `fifa.world` 的 scorers 数据来源（scoreboard 聚合）零改动，仅在渲染入口把 `TopScorer` 映射成 `Leader`。加法式、单类别、榜单行不可点击。

**Architecture:** 一个纯函数聚合器 `src/leaders.ts`（`assembleLeaders(fetchImpl, cfg)` + per-sport `LEADERS_BY_SPORT`），被 Worker 路由（`/api/<key>/leaders`，经新增 `cachedProducer` 缓存产物）与 Vite dev 中间件（`configureServer`，dev 不缓存）**共用同一实现**——延续 `buildUrl`/`competitions.ts` 的「单一事实源、双 build 目标编译」纪律。前端 `useLeaders(comp)` 只在 `COMPETITIONS[comp].leadersSource==='pipeline'` 时调用；`LeadersView`（由 `TopScorersView` 泛化）渲染 `Leader[]`。`FixturesView` 的 scorers tab 按 `leadersSource` 分叉：`scoreboard`（WC）把 `useCompetition().scorers`（`TopScorer[]`）映射为 `Leader[]`；`pipeline` 用 `useLeaders`。

**Tech Stack:** React 18, TypeScript 5.9, Vitest 1.6 + @testing-library/react（jsdom, `globals: true`, `fileParallelism: false`），Vite 5.4，自研 i18n（4 语言），Biome 2.5，Cloudflare Worker（`worker/index.ts` KV 边缘缓存）。

## Global Constraints

以下规则为绑定项，违反即计划失败：

- **Biome**（`biome.json`）：2 空格缩进、单引号、分号、尾逗号、行宽 100。`style` 规则组关闭；`*.css` 与 `worker-configuration.d.ts` 排除。每个任务结束前 `npm run lint` 必须绿（必要时先 `npm run format`）。
- **i18n 四语并行**：任何新 key 必须在 `en/zh/ja/ko` 四种语言里都加，`src/i18n/messages.test.ts` 强制键对齐（en 为 fallback）。
- **颜色只走 token**：调色板是 `src/index.css` `:root` 的 `--c-*` 通道值，映射到 Tailwind 语义色（`night`/`panel`/`panel2`/`line`/`chalk`/`chalkdim`/`pitch`/`live`/`amber` 等）。不硬编码 hex/`rgba()`，不用 Tailwind 命名调色板做复现性语义色；`bg-white/5` / `bg-overlay/[0.02]` 式半透明叠层是既有高度提升惯用法，不需要 token。
- **视觉风格**：圆角「Apple Sports」外观（rounded-*、软阴影、叠层）。不重新引入 `borderRadius: 0`。
- **typecheck 覆盖 app + worker**：`npm run typecheck` 同时跑 app tsconfig 与 `tsconfig.worker.json`。每个任务结束前必须绿。
- **`src/leaders.ts` 必须纯/无 DOM/无 React**：它被 worker（`worker/index.ts` → worker tsconfig）、app（`src/hooks/useLeaders.ts`）、vite 配置（`vite.config.ts`，Node 环境）三处 import，任何 DOM/React/浏览器专属 API 都会让某一 build 目标编译失败。只用 `fetch` 类型（注入）、`Promise`、标准 JS。
- **测试用手工内联 JSON 形状 + 注入假实现，绝不打网络**：`assembleLeaders` 单测注入一个 `fetchImpl`，按 URL 返回 canned leaders 载荷 + 各 athlete/team `$ref` 载荷；worker/hook 测试用现成的 fetch-mock/KV-mock 模式。
- **vitest `fileParallelism: false`**（串行，别假设并行隔离加速）。测试 colocated（`*.test.ts(x)`）。
- **worker 路由与 vite 代理保持同步**：新增 `/api/<key>/leaders` 必须同时在 `worker/index.ts`（prod）和 `vite.config.ts`（dev 中间件）落地——两处走同一 `assembleLeaders`，无第二实现、无漂移。`leaders` 无法用 URL rewrite 表达（它是聚合多个上游请求），所以 dev 侧是 `configureServer` 中间件而非 proxy rewrite。
- **单一事实源**：sport/shape/capabilities/`leadersSource` 一律读 `COMPETITIONS[comp]`。
- **契约名绑定（spec §4）**：`Leader`、`LeadersConfig`、`assembleLeaders(fetchImpl, cfg)`、`LEADERS_BY_SPORT`、`cachedProducer`、`leadersSource` 用 spec 的**确切名字**，跨任务保持一致，不得自造别名。
- **非目标（spec §2）**：不做 NBA 多类别（单得分榜）；不改 WC scorers 来源；榜单行**不可点击**（无 onClick/link/button）；dev 不缓存。
- **删除死字段**：`Competition.capabilities.leaders` 从未被读，本计划用 `capabilities.scorers` + `leadersSource` 表达榜单，删掉它。

---

### Task 1: `Leader` 类型 + `src/leaders.ts`（`LEADERS_BY_SPORT` + `assembleLeaders`）

**Files:**
- Modify: `src/types/index.ts`（新增 `Leader` interface）
- Create: `src/leaders.ts`
- Create: `src/leaders.test.ts`

**Interfaces:**
- Consumes: 无（纯新增；`assembleLeaders` 注入 `fetchImpl: typeof fetch`）。
- Produces（spec §4 绑定命名，后续所有任务引用这些确切形状）：

```ts
// src/types/index.ts
export interface Leader {
  rank: number; // 1-based, sorted by value desc
  name: string; // athlete displayName
  teamName: string;
  teamLogo: string; // '' if unknown
  displayValue: string; // ESPN raw ("27" / "30.2")
  value: number; // sort key
}

// src/leaders.ts
export interface LeadersConfig {
  sport: string;
  league: string;
  season: number;
  type: number; // soccer 1 / basketball 2
  category: string; // 'goals' / 'points'
  topN: number; // 15
}
export const LEADERS_BY_SPORT: Record<string, { type: number; category: string }>;
export async function assembleLeaders(
  fetchImpl: typeof fetch,
  cfg: LeadersConfig,
): Promise<Leader[]>;
```

- [ ] **Step 1: 写失败测试 `src/leaders.test.ts`** —— 注入一个按 URL 返回 canned JSON 的假 `fetchImpl`（零网络）。核心 fixture：一个 leaders 载荷（`categories[]`，含 `goals`/`assists` 两类，`goals` 有 3 条），加各 athlete/team `$ref` 载荷；断言：类别选择正确、topN 截断、按 value 降序 + rank 从 1、名字/队徽解析、team ref 去重（两条同队只解析一次 team）、缺失 ref 降级不 throw、空载荷返回 `[]`。完整内容：

```ts
import { describe, expect, it, vi } from 'vitest';
import { assembleLeaders, LEADERS_BY_SPORT, type LeadersConfig } from './leaders';

// --- canned upstream payloads keyed by URL (NO network) ---
const LEADERS_URL =
  'https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/types/1/leaders';
const ATH1 = 'https://ath/1';
const ATH2 = 'https://ath/2';
const ATH3 = 'https://ath/3';
const TEAM_MCI = 'https://team/mci';
const TEAM_ARS = 'https://team/ars';

const leadersPayload = {
  categories: [
    {
      name: 'assists',
      leaders: [{ displayValue: '10', value: 10, athlete: { $ref: ATH1 }, team: { $ref: TEAM_MCI } }],
    },
    {
      name: 'goals',
      leaders: [
        // deliberately NOT pre-sorted, to prove we sort by value desc
        { displayValue: '18', value: 18, athlete: { $ref: ATH2 }, team: { $ref: TEAM_ARS } },
        { displayValue: '27', value: 27, athlete: { $ref: ATH1 }, team: { $ref: TEAM_MCI } },
        { displayValue: '9', value: 9, athlete: { $ref: ATH3 }, team: { $ref: TEAM_MCI } },
      ],
    },
  ],
};

const athletes: Record<string, unknown> = {
  [ATH1]: { displayName: 'Erling Haaland', shortName: 'E. Haaland' },
  [ATH2]: { displayName: 'Bukayo Saka', shortName: 'B. Saka' },
  [ATH3]: { displayName: 'Julián Álvarez', shortName: 'J. Álvarez' },
};
const teams: Record<string, unknown> = {
  [TEAM_MCI]: { displayName: 'Manchester City', logos: [{ href: 'mci.png' }] },
  [TEAM_ARS]: { displayName: 'Arsenal', logos: [{ href: 'ars.png' }] },
};

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

// A fake fetch that resolves each URL from the canned maps above.
function makeFetch(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    [LEADERS_URL]: leadersPayload,
    ...athletes,
    ...teams,
    ...overrides,
  };
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!(url in table)) throw new Error(`unexpected url: ${url}`);
    const body = table[url];
    if (body === '__404__') return { ok: false, json: async () => ({}) } as unknown as Response;
    return jsonResponse(body);
  }) as unknown as typeof fetch;
}

const eplCfg: LeadersConfig = {
  sport: 'soccer',
  league: 'eng.1',
  season: 2026,
  type: 1,
  category: 'goals',
  topN: 15,
};

describe('LEADERS_BY_SPORT', () => {
  it('maps soccer→goals(type 1) and basketball→points(type 2)', () => {
    expect(LEADERS_BY_SPORT.soccer).toEqual({ type: 1, category: 'goals' });
    expect(LEADERS_BY_SPORT.basketball).toEqual({ type: 2, category: 'points' });
  });
});

describe('assembleLeaders', () => {
  it('picks the configured category, sorts by value desc, ranks from 1', async () => {
    const fetchImpl = makeFetch();
    const leaders = await assembleLeaders(fetchImpl, eplCfg);
    expect(leaders.map((l) => l.rank)).toEqual([1, 2, 3]);
    expect(leaders.map((l) => l.value)).toEqual([27, 18, 9]);
    expect(leaders.map((l) => l.name)).toEqual([
      'Erling Haaland',
      'Bukayo Saka',
      'Julián Álvarez',
    ]);
    expect(leaders.map((l) => l.displayValue)).toEqual(['27', '18', '9']);
  });

  it('resolves athlete name and team name/logo from the $refs', async () => {
    const leaders = await assembleLeaders(makeFetch(), eplCfg);
    expect(leaders[0]).toEqual({
      rank: 1,
      name: 'Erling Haaland',
      teamName: 'Manchester City',
      teamLogo: 'mci.png',
      displayValue: '27',
      value: 27,
    });
  });

  it('dedupes team $refs (two City players → the team is fetched once)', async () => {
    const fetchImpl = makeFetch();
    await assembleLeaders(fetchImpl, eplCfg);
    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const cityCalls = spy.mock.calls.filter((c) => String(c[0]) === TEAM_MCI);
    expect(cityCalls).toHaveLength(1);
  });

  it('truncates to topN before resolving refs', async () => {
    const leaders = await assembleLeaders(makeFetch(), { ...eplCfg, topN: 2 });
    expect(leaders).toHaveLength(2);
    expect(leaders.map((l) => l.value)).toEqual([27, 18]);
  });

  it('degrades a row (empty name/teamName) when a ref fetch fails, without throwing', async () => {
    // ATH2's athlete ref 404s → row keeps rank/value/displayValue but name=''.
    const fetchImpl = makeFetch({ [ATH2]: '__404__' });
    const leaders = await assembleLeaders(fetchImpl, eplCfg);
    expect(leaders).toHaveLength(3);
    const saka = leaders[1];
    expect(saka.value).toBe(18);
    expect(saka.name).toBe('');
    // teamName still resolves (Arsenal ref is fine)
    expect(saka.teamName).toBe('Arsenal');
  });

  it('returns [] when the category is absent', async () => {
    const fetchImpl = makeFetch({ [LEADERS_URL]: { categories: [{ name: 'assists', leaders: [] }] } });
    expect(await assembleLeaders(fetchImpl, eplCfg)).toEqual([]);
  });

  it('returns [] on an empty leaders payload without throwing', async () => {
    const fetchImpl = makeFetch({ [LEADERS_URL]: {} });
    expect(await assembleLeaders(fetchImpl, eplCfg)).toEqual([]);
  });

  it('builds the core.api URL from the config (sport/league/season/type)', async () => {
    const fetchImpl = makeFetch();
    await assembleLeaders(fetchImpl, eplCfg);
    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(spy.mock.calls.some((c) => String(c[0]) === LEADERS_URL)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/leaders.test.ts`
Expected: FAIL —— `./leaders` 模块不存在（import 报错）。

- [ ] **Step 3: 加 `Leader` 类型到 `src/types/index.ts`** —— 在文件末尾（`TopScorer` interface 之后，当前第 158 行 `}` 之后）追加：

```ts

// A single leaderboard row for the season leaders pipeline (eng.1 goals /
// nba points). Unlike TopScorer (tournament scoreboard aggregation, kept for
// the World Cup), this is assembled server-side from ESPN's core.api leaders
// endpoint + athlete/team $ref fan-out. `displayValue` is ESPN's own format
// ("27" / "30.2") so we sidestep the total-vs-per-game question; `value` is
// the numeric sort key. Rows are NOT clickable (no player-page nav).
export interface Leader {
  rank: number; // 1-based, sorted by value desc
  name: string; // athlete displayName ('' if the ref failed to resolve)
  teamName: string; // '' if unknown
  teamLogo: string; // team crest URL, '' if unknown
  displayValue: string; // ESPN raw display, e.g. "27" or "30.2"
  value: number; // numeric value for sorting
}
```

- [ ] **Step 4: 写 `src/leaders.ts`** —— 纯函数、无 DOM/React。防御性 `obj()/arr()/str()`（房屋风格，与 `src/adapters/soccer.ts` 一致）。流程：拉 leaders URL → 取 `categories` 里 `name===cfg.category` 的 `leaders` → 按 `value` 降序 → 截 topN → 收集去重后的 athlete + team `$ref` → 并发上限 10 解析 → 组装 `Leader[]`，`rank` 从 1；任何 ref 解析失败该行降级（name/teamName/teamLogo 空串），不 throw。完整代码：

```ts
// Shared season-leaders aggregator. PURE — no DOM/React/browser APIs — so the
// Cloudflare Worker (worker/index.ts), the app (src/hooks/useLeaders.ts), and
// the Vite dev middleware (vite.config.ts) all compile and reuse this one
// implementation (same single-source discipline as competitions.ts/buildUrl).
// `fetch` is injected so tests can supply a canned fake (zero network).

import type { Leader } from './types';

// ESPN's season leaders live on the CORE api (not site.api), one document per
// sport/league/season/type. Each category (`goals`, `points`, `assists`, …)
// holds `leaders[]`, and every leader references its athlete/team by $ref
// (no inline names) — hence the fan-out below.
const CORE = 'https://sports.core.api.espn.com/v2';

export interface LeadersConfig {
  sport: string; // ESPN sport slug, e.g. 'soccer' / 'basketball'
  league: string; // ESPN league slug, e.g. 'eng.1' / 'nba'
  season: number; // ending/starting year per sport (from seasonForDate)
  type: number; // season type: soccer regular = 1, nba regular = 2
  category: string; // which leaders category to surface: 'goals' / 'points'
  topN: number; // how many rows to keep (and how many refs to fan out to)
}

// Per-sport { type, category }: which single category is "the" leaderboard.
// Other sports are added when a competition needs them (YAGNI).
export const LEADERS_BY_SPORT: Record<string, { type: number; category: string }> = {
  soccer: { type: 1, category: 'goals' },
  basketball: { type: 2, category: 'points' },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function obj(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// A single leaders row before its refs are resolved.
interface RawRow {
  displayValue: string;
  value: number;
  athleteRef: string;
  teamRef: string;
}

// Resolve $refs with a small concurrency cap so we never blow past the
// Cloudflare Workers 50-subrequest limit (topN 15 + deduped teams ≈ ≤25).
async function resolveRefs(
  fetchImpl: typeof fetch,
  refs: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const limit = 10;
  let i = 0;
  async function worker(): Promise<void> {
    while (i < refs.length) {
      const ref = refs[i++];
      try {
        const res = await fetchImpl(ref);
        if (!res.ok) continue; // degrade: leave the ref unresolved
        out.set(ref, obj(await res.json()));
      } catch {
        // degrade: any network/parse failure leaves this ref unresolved
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, refs.length) }, () => worker()));
  return out;
}

export async function assembleLeaders(
  fetchImpl: typeof fetch,
  cfg: LeadersConfig,
): Promise<Leader[]> {
  const url = `${CORE}/sports/${cfg.sport}/leagues/${cfg.league}/seasons/${cfg.season}/types/${cfg.type}/leaders`;

  let payload: Record<string, unknown>;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return [];
    payload = obj(await res.json());
  } catch {
    return [];
  }

  const category = arr(payload.categories)
    .map(obj)
    .find((c) => str(c.name) === cfg.category);
  if (!category) return [];

  const rows: RawRow[] = arr(category.leaders)
    .map(obj)
    .map((l) => ({
      displayValue: str(l.displayValue),
      value: Number(l.value) || 0,
      athleteRef: str(obj(l.athlete).$ref),
      teamRef: str(obj(l.team).$ref),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, cfg.topN);

  // Dedupe refs so a team shared by several leaders is fetched once.
  const refs = [
    ...new Set([
      ...rows.map((r) => r.athleteRef).filter(Boolean),
      ...rows.map((r) => r.teamRef).filter(Boolean),
    ]),
  ];
  const resolved = await resolveRefs(fetchImpl, refs);

  return rows.map((r, i): Leader => {
    const athlete = resolved.get(r.athleteRef);
    const team = resolved.get(r.teamRef);
    const logos = team ? arr(team.logos) : [];
    return {
      rank: i + 1,
      name: athlete ? str(athlete.displayName) || str(athlete.shortName) : '',
      teamName: team ? str(team.displayName) : '',
      teamLogo: logos.length ? str(obj(logos[0]).href) : '',
      displayValue: r.displayValue,
      value: r.value,
    };
  });
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/leaders.test.ts`
Expected: PASS（8 个用例：类别选择/排序/rank、ref 解析、team 去重、topN 截断、降级不 throw、缺类别、空载荷、URL 构造全绿）。

- [ ] **Step 6: 全量 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 无错误（`src/leaders.ts` 无 DOM/React 依赖，app + worker tsconfig 均编译通过）。

- [ ] **Step 7: 提交**

```bash
git add src/types/index.ts src/leaders.ts src/leaders.test.ts
git commit -m "$(cat <<'EOF'
feat(leaders): Leader type + pure assembleLeaders aggregator

Add the Leader display model and src/leaders.ts (LEADERS_BY_SPORT +
assembleLeaders): fetches ESPN core.api leaders, picks one category, sorts by
value, dedupes team $refs, fans out (concurrency 10) to resolve athlete/team
names, degrades failed rows without throwing. Injected-fetch unit tests, no
network. No DOM/React so worker + app + vite all compile it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChocVWiknZXDoEx8ZcZHe3
EOF
)"
```

---

### Task 2: Worker — `cachedProducer` + `/api/<key>/leaders` 路由

**Files:**
- Modify: `worker/index.ts`
- Modify: `worker/index.test.ts`

**Interfaces:**
- Consumes: `assembleLeaders`/`LeadersConfig`/`LEADERS_BY_SPORT`（`src/leaders.ts`，Task 1）、`Leader`（`src/types`，Task 1）、`COMPETITIONS`/`seasonForDate`（`src/competitions.ts`）、现有 `Env`/`Entry`/`CachedResult`/`json`/`inflight`（`worker/index.ts`）。
- Produces：
  - `cachedProducer(cacheKey, producer, fresh, keep, env, ctx)`：缓存**任意 async producer** 的产物（现有 `cached()` 只缓单 URL 抓取），复用同一 KV/coalescing/serve-stale 语义。签名：

```ts
async function cachedProducer(
  cacheKey: string,
  producer: () => Promise<unknown>, // returns a JSON-serializable value
  fresh: number,
  keep: number,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response>
```

  - `serveLeaders(comp, env, ctx): Promise<Response>`（exported，供测试直接调）。
  - 路由 `/api/<key>/leaders`（未知 key → 404，沿用 `Object.hasOwn` 守卫）。
- 去重纪律：`cached` 与 `cachedProducer` 共享同一 `runCached` 核心（下方 Step 3 抽出），避免两份缓存逻辑漂移。

- [ ] **Step 1: 写失败测试** —— 在 `worker/index.test.ts`：

1a. 顶部导入把 `serve, serveSummary` 那行加上 `serveLeaders`：

```ts
import worker, { type Env, json, serve, serveLeaders, serveSummary } from './index';
```

1b. `mockEnv` 的默认 key 参数目前是 `'fifa.world:standings'`；leaders 用例会传自己的 key，无需改。在 `serveSummary` 的 describe 块之后、`fetch routing` 的 describe 块之前，插入一个新 describe：

```ts
describe('serveLeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // nba is a pipeline comp; season is derived at request time. We assert cache
  // semantics via the KV mock (HIT/MISS/STALE), not the exact upstream URLs —
  // assembleLeaders itself is unit-tested in src/leaders.test.ts.
  const NBA = COMPETITIONS.nba;

  it('returns HIT with the stored Leader[] when fresh', async () => {
    const now = Date.now();
    const cached = JSON.stringify([
      { rank: 1, name: 'L. James', teamName: 'Lakers', teamLogo: '', displayValue: '30.2', value: 30.2 },
    ]);
    const env = mockEnv({ body: cached, at: now - 60_000 }, 'nba:leaders'); // fresh is 3600s
    const res = await serveLeaders(NBA, env as unknown as Env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(await res.text()).toBe(cached);
    expect(fetchMock).not.toHaveBeenCalled(); // fresh HIT never runs the producer
  });

  it('runs the producer and caches its result on a MISS', async () => {
    // The producer (assembleLeaders) fetches the leaders doc then athlete/team
    // refs. Canned: an empty categories payload → assembleLeaders returns [].
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ categories: [] }) });
    const env = mockEnv(null, 'nba:leaders');
    const ctx = mockCtx();
    const res = await serveLeaders(NBA, env as unknown as Env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(await res.text()).toBe('[]');
    expect(ctx.waitUntil).toHaveBeenCalled();
    expect((env.CACHE as ReturnType<typeof mockEnv>['CACHE']).put).toHaveBeenCalledWith(
      'nba:leaders',
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it('serves a STALE stored copy when the producer throws', async () => {
    fetchMock.mockRejectedValue(new Error('core.api down'));
    const stale = JSON.stringify([{ rank: 1, name: 'x', teamName: '', teamLogo: '', displayValue: '1', value: 1 }]);
    const env = mockEnv({ body: stale, at: Date.now() - 7_200_000 }, 'nba:leaders'); // stale (fresh 3600s)
    const res = await serveLeaders(NBA, env as unknown as Env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('STALE');
    expect(await res.text()).toBe(stale);
  });
});
```

> 注：`assembleLeaders` 对空 `categories` 返回 `[]`，producer 序列化为 `'[]'`——即便某上游成功，producer 内部所有 ref 请求都不会发生（因 `[]`），所以 STALE 用例用 `mockRejectedValue` 让最外层 leaders 请求本身失败。但 `assembleLeaders` 捕获 leaders 请求失败并返回 `[]`（不 throw），STALE 语义要求 producer **throw**。因此本任务的 `serveLeaders` producer 必须在 `assembleLeaders` 之外自行判定失败——见 Step 4：producer 用一个「先探测 leaders 请求成败、失败则 throw」的包装。改用下方 Step 4 的 producer 实现（它让上游失败冒泡为 throw，触发 serve-stale），本测试即成立。

1c. 在 `fetch routing` 的 describe 块里，追加一个 leaders 路由用例（放在 `'routes a known competition scoreboard through serve'` 之后）：

```ts
  it('routes a known competition leaders through serveLeaders', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ categories: [] }) });
    const env = mockEnv(null, 'nba:leaders');
    const res = await worker.fetch(
      new Request('https://x/api/nba/leaders'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[]');
  });

  it('404s on leaders for an unknown competition key', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(
      new Request('https://x/api/nope/leaders'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run worker/index.test.ts`
Expected: FAIL —— `serveLeaders` 未从 `./index` 导出（import 报错）；`/api/nba/leaders` 路由不匹配现有正则，返回 404 而非 200。

- [ ] **Step 3: 抽出共享缓存核心 `runCached`，用它重写 `cached`** —— 在 `worker/index.ts` 把现有 `cached`（当前第 77–130 行）**整体替换**为下面的 `runCached`（缓任意 producer）+ 薄封装 `cached`（保持旧签名与行为，供 `serve`/`serveSummary` 不变）。这消除了「两份缓存逻辑」的漂移风险：

先看当前 `cached` 的核心（fetch 部分）——它硬编码了 `fetchWithRetry(url, {...})`。`runCached` 把「产出 body 字符串」抽象成一个 `produce: () => Promise<string>` 回调；`cached` 传一个抓 URL 的回调，`cachedProducer` 传一个 `JSON.stringify(await producer())` 的回调。替换为：

```ts
// Shared cache/coalesce/serve-stale core. `produce` returns the body STRING to
// cache (a URL fetch for `cached`, JSON.stringify(producer()) for
// `cachedProducer`). Both entry points share this so there's exactly one copy
// of the KV + in-flight coalescing + serve-stale-on-outage logic.
async function runCached(
  cacheKey: string,
  produce: () => Promise<string>,
  fresh: number,
  keep: number,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const stored = await env.CACHE.get<Entry>(cacheKey, 'json');
  const now = Date.now();

  if (stored && now - stored.at < fresh * 1000) {
    return json(stored.body, 200, 'HIT');
  }

  // Coalesce: if an identical request is already in-flight, piggyback on it.
  const pending = inflight.get(cacheKey);
  if (pending) {
    const result = await pending;
    return json(result.body, result.status, result.cache);
  }

  const promise = (async (): Promise<CachedResult> => {
    try {
      const body = await produce();
      ctx.waitUntil(
        env.CACHE.put(cacheKey, JSON.stringify({ body, at: now } satisfies Entry), {
          expirationTtl: keep,
        }),
      );
      return { body, status: 200, cache: stored ? 'REVALIDATED' : 'MISS' };
    } catch (err) {
      console.error(`[worker] produce failed for ${cacheKey}:`, err);
      if (stored) return { body: stored.body, status: 200, cache: 'STALE' };
      return { body: '{"error":"upstream unavailable"}', status: 502, cache: 'MISS' };
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  const result = await promise;
  return json(result.body, result.status, result.cache);
}

// Cache a single upstream URL fetch (scoreboard/standings/summary).
async function cached(
  cacheKey: string,
  url: string,
  fresh: number,
  keep: number,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return runCached(
    cacheKey,
    async () => {
      const res = await fetchWithRetry(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          accept: 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      return res.text();
    },
    fresh,
    keep,
    env,
    ctx,
  );
}

// Cache the RESULT of an arbitrary async producer (e.g. assembleLeaders, which
// aggregates several upstream requests into a Leader[]). Same KV/coalescing/
// serve-stale semantics as `cached`, but the producer decides what to fetch.
async function cachedProducer(
  cacheKey: string,
  producer: () => Promise<unknown>,
  fresh: number,
  keep: number,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return runCached(cacheKey, async () => JSON.stringify(await producer()), fresh, keep, env, ctx);
}
```

> 行为等价性：旧 `cached` 里 `stored ? 'REVALIDATED' : 'MISS'`、STALE/502、coalescing、`inflight.delete` 全部原样保留在 `runCached`；唯一变化是「抓 URL」从内联变成 `cached` 传入的 `produce` 回调。现有 `serve`/`serveSummary` 调用 `cached(...)` 签名不变，`worker/index.test.ts` 现有 serve/serveSummary 断言不受影响。

- [ ] **Step 4: 加 `serveLeaders` + leaders 路由** —— 在 `worker/index.ts`：

4a. 顶部导入加一行（`competitions` 导入之后）：

```ts
import { assembleLeaders, LEADERS_BY_SPORT } from '../src/leaders';
```

并把现有 `competitions` 导入补上 `seasonForDate`：

```ts
import { type Competition, COMPETITIONS, type Resource, buildUrl, seasonForDate } from '../src/competitions';
```

4b. 在 `serveSummary` 之后加 `serveLeaders`（TTL 用 spec §4.3 的 fresh 3600 / keep 86400）：

```ts
// Season leaders (eng.1 goals / nba points): aggregated by assembleLeaders from
// ESPN's core.api (leaders doc + athlete/team $ref fan-out). We cache the
// PRODUCT (a Leader[]) via cachedProducer — not a single URL — so all the
// sub-requests collapse into one cached payload. Season stats change slowly:
// fresh 1h, keep 24h. The producer lets an upstream failure bubble so
// serve-stale can cover an outage (assembleLeaders itself never throws, so we
// probe the leaders doc first and rethrow on a bad response).
export async function serveLeaders(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const map = LEADERS_BY_SPORT[comp.sport];
  if (!map) return json('{"error":"leaders not supported for this sport"}', 400, 'MISS');
  const cfg = {
    sport: comp.sport,
    league: comp.league,
    season: seasonForDate(comp.sport, new Date()),
    type: map.type,
    category: map.category,
    topN: 15,
  };
  return cachedProducer(
    `${comp.key}:leaders`,
    () => assembleLeaders(fetch, cfg),
    3600,
    86400,
    env,
    ctx,
  );
}
```

> STALE 语义说明：`assembleLeaders` 捕获自身错误并返回 `[]`（不 throw）。这意味着上游全挂时 producer 返回 `[]`，`cachedProducer` 会把 `'[]'` 当成成功结果缓存/返回，而非 serve-stale。这是可接受的降级（空榜单），但 Step 1 的 STALE 用例要求 producer throw。为满足「serve-stale 覆盖 core.api 短暂故障」这一 spec §7 风险缓解，且不改 `assembleLeaders` 的「不 throw」纯函数契约，producer 改为**先探测 leaders 文档、失败即 rethrow**：

把上面 `() => assembleLeaders(fetch, cfg)` 替换为一个探测包装 `leadersProducer(cfg)`，在 `serveLeaders` 上方定义：

```ts
// Probe the leaders document first; if it fails, throw so cachedProducer can
// serve a stale copy (assembleLeaders swallows failures and returns [], which
// would otherwise cache an empty board over a transient outage). On success we
// hand the same fetch to assembleLeaders (its own cheap re-fetch of the doc is
// coalesced upstream and negligible vs the ref fan-out).
async function leadersProducer(cfg: Parameters<typeof assembleLeaders>[1]): Promise<unknown> {
  const url = `https://sports.core.api.espn.com/v2/sports/${cfg.sport}/leagues/${cfg.league}/seasons/${cfg.season}/types/${cfg.type}/leaders`;
  const probe = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!probe.ok) throw new Error(`leaders upstream ${probe.status}`);
  return assembleLeaders(fetch, cfg);
}
```

并把 `cachedProducer` 调用改为 `() => leadersProducer(cfg)`。

> 这样：MISS 用例（`categories:[]`）probe 成功 → assembleLeaders 返回 `[]` → 缓存 `'[]'`（测试断言 `'[]'`）；STALE 用例（`mockRejectedValue`）probe throw → serve-stale（测试断言 STALE）。`fetch` 是全局，测试里 `globalThis.fetch = fetchMock`，故 probe 与 assembleLeaders 内部都命中 mock。

4c. 在 `default.fetch` 的路由正则里加入 `leaders`（当前第 163 行）：

```ts
    const m = url.pathname.match(/^\/api\/([^/]+)\/(scoreboard|standings|summary|leaders)$/);
```

并在 resource 分派里加 leaders 分支（在 `if (resource === 'summary')` 之后、`return serve(...)` 之前）：

```ts
      if (resource === 'leaders') {
        return serveLeaders(comp, env, ctx);
      }
```

> `resource` 当前被 `as Resource` 断言；`'leaders'` 不在 `Resource` 联合里。为保持类型正确，把这行断言前的窄化用正则捕获组保证——改 `const resource = m[2] as Resource;` 为 `const resource = m[2];`（`m[2]` 是 `string`），并在下方分支里字符串比较（`resource === 'summary'` / `'leaders'`），传给 `serve(comp, resource as 'scoreboard' | 'standings', ...)` 时断言。具体见 4d。

4d. 调整 resource 分派块（当前第 167–171 行）为：

```ts
      const resource = m[2];
      if (resource === 'summary') {
        return serveSummary(comp, url.searchParams.get('event') ?? '', env, ctx);
      }
      if (resource === 'leaders') {
        return serveLeaders(comp, env, ctx);
      }
      return serve(comp, resource as 'scoreboard' | 'standings', env, ctx);
```

（删掉原 `const resource = m[2] as Resource;` 那行——`Resource` 类型不含 `leaders`，改用字符串窄化 + 末尾断言。`Resource` 导入若因此变为未用会被 lint 抓到；它仍被 `serve` 的参数类型间接需要吗？`serve` 的 `resource` 形参类型是 `'scoreboard' | 'standings'` 字面量联合，不引用 `Resource`；但 `buildUrl` 的签名用 `Resource`，`worker/index.ts` 仍 `import type { Resource }` 吗？当前它 `import { ..., type Resource, ... }`。若 `Resource` 在文件内不再被引用，删除该导入项以免 lint 报未用。检查：替换后 `Resource` 无引用 → 从导入里删掉 `type Resource,`。）

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run worker/index.test.ts`
Expected: PASS —— 新增 serveLeaders（HIT/MISS/STALE）+ leaders 路由（200 + 404）全绿；现有 serve/serveSummary/coalescing/routing 18 个用例仍全绿（`runCached` 重构行为等价）。

- [ ] **Step 6: 全量 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 无错误（worker tsconfig 编译 `src/leaders.ts`；`Resource` 未用导入已清理）。

- [ ] **Step 7: 提交**

```bash
git add worker/index.ts worker/index.test.ts
git commit -m "$(cat <<'EOF'
feat(worker): cachedProducer + /api/<key>/leaders route

Factor the KV/coalescing/serve-stale core out of cached() into runCached();
cached() (URL fetch) and new cachedProducer() (arbitrary async product) both
delegate to it — one copy of the cache logic, no drift. Add serveLeaders:
derives a LeadersConfig from the registry, probes the core.api leaders doc
(rethrow → serve-stale), and caches assembleLeaders' Leader[] (fresh 1h/keep
24h). Route /api/<key>/leaders with the Object.hasOwn guard.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChocVWiknZXDoEx8ZcZHe3
EOF
)"
```

---

### Task 3: Vite dev 中间件 — `/api/<key>/leaders`（复用同一 `assembleLeaders`）

**Files:**
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `assembleLeaders`/`LEADERS_BY_SPORT`（`src/leaders.ts`，Task 1）、`COMPETITIONS`/`seasonForDate`（`src/competitions.ts`）。
- Produces: dev-only 中间件，拦截 `GET /api/<key>/leaders`，用 `globalThis.fetch` 调 `assembleLeaders`，写 JSON 响应（dev 不缓存，spec §4.4）。与 Worker 走同一 `assembleLeaders`，无第二实现。

> **Vite 中间件 API（已按 `vite@^5.4.21` 核对）**：`configureServer(server)` 是插件 hook；`server.middlewares` 是一个 [connect](https://github.com/senchalabs/connect) 实例，`server.middlewares.use((req, res, next) => {…})` 注册 Node 风格中间件，`req`/`res` 是 `http.IncomingMessage` / `http.ServerResponse`。返回一个函数会让 Vite 在**内置中间件之后**安装它（`return () => { server.middlewares.use(...) }`）——这对我们无所谓（我们不与其它中间件冲突），直接在 hook 体内 `server.middlewares.use(...)` 即可，它会在 Vite 内部中间件**之前**运行，先于 `proxy`，所以 leaders 请求不会落到 `/api` proxy 的 rewrite（rewrite 遇到 `leaders` 会 `return p` 原样转发到 ESPN 而 404，因此必须由本中间件先拦下）。`leaders` **不能**用 proxy rewrite 表达（它聚合多个上游请求，不是单 URL 重写）。

- [ ] **Step 1: 加 dev 中间件到 `vite.config.ts`** —— 本任务无自动化单测（`assembleLeaders` 已在 Task 1 全面单测；中间件是薄 glue，靠手测验证，spec §6）。

1a. 顶部导入补上 `assembleLeaders`/`LEADERS_BY_SPORT`/`seasonForDate`：

```ts
import { buildUrl, COMPETITIONS, seasonForDate } from './src/competitions';
import { assembleLeaders, LEADERS_BY_SPORT } from './src/leaders';
```

1b. 加一个内联插件（放在 `plugins: [react()]` → 改为 `plugins: [react(), leadersDevMiddleware()]`），在 `defineConfig` 调用**之前**定义该插件工厂：

```ts
// dev only: /api/<key>/leaders can't be a URL rewrite (it aggregates several
// upstream core.api requests into one Leader[]). Intercept it here and run the
// SAME assembleLeaders the Worker uses — no second implementation, no drift.
// No caching in dev (that's the Worker's job in prod; see worker/index.ts).
function leadersDevMiddleware(): import('vite').Plugin {
  return {
    name: 'leaders-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const m = url.pathname.match(/^\/api\/([^/]+)\/leaders$/);
        if (!m) return next();
        const comp = COMPETITIONS[m[1]];
        const map = comp && LEADERS_BY_SPORT[comp.sport];
        if (!comp || !map) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        try {
          const leaders = await assembleLeaders(globalThis.fetch, {
            sport: comp.sport,
            league: comp.league,
            season: seasonForDate(comp.sport, new Date()),
            type: map.type,
            category: map.category,
            topN: 15,
          });
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(leaders));
        } catch (err) {
          console.error('[vite] leaders middleware failed:', err);
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end('{"error":"leaders unavailable"}');
        }
      });
    },
  };
}
```

> `buildUrl` 仍被下方 `/api` proxy rewrite 用到，`seasonForDate` 现在也被中间件用到——两者都从 `./src/competitions` 导入，保持。中间件在 proxy 之前拦截 `leaders`，其它 `/api/*` 路径继续走 proxy rewrite（`m` 不匹配 → `next()`）。

- [ ] **Step 2: typecheck 确认 vite.config.ts 编译**

Run: `npm run typecheck`
Expected: 无错误（`import('vite').Plugin` 类型可用；`server.middlewares.use` 签名匹配 connect）。

> 说明：`vite.config.ts` 不在 app tsconfig 的 `include` 里被跑吗？它被 vite 自身用 esbuild 编译，`npm run typecheck` 的 `tsc` 覆盖范围取决于 `tsconfig.json` 的 include。若 `tsc` 不检查 `vite.config.ts`，本 step 至少保证 Task 1/2 未回归；中间件的类型正确性由 Step 3 的 `vite build`/`npm run dev` 手测兜底。

- [ ] **Step 3: 手动验证（无自动化单测）** —— 记录在提交信息里，执行者实际跑一次：

```bash
npm run dev
# 另开终端：
curl -s http://localhost:5173/api/nba/leaders | head -c 400
curl -s http://localhost:5173/api/eng.1/leaders | head -c 400
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/api/nope/leaders   # 期望 404
# 期望：nba/eng.1 返回 Leader[] JSON（off-season 可能为 []）；scoreboard 仍走 proxy：
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/api/nba/scoreboard  # 期望 200
```

Expected: `/api/nba/leaders` 与 `/api/eng.1/leaders` 返回 JSON 数组（每条含 `rank/name/teamName/teamLogo/displayValue/value`；赛季空窗可能为 `[]`）；`/api/nope/leaders` → 404；`/api/nba/scoreboard` 仍经 proxy → 200（证明中间件只拦 leaders，其它 `/api/*` 未受影响）。

- [ ] **Step 4: lint**

Run: `npm run lint`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add vite.config.ts
git commit -m "$(cat <<'EOF'
feat(vite): dev middleware for /api/<key>/leaders

configureServer middleware intercepts leaders (can't be a proxy URL rewrite —
it aggregates several upstream requests) and runs the SAME assembleLeaders the
Worker uses, no caching in dev. Verified manually: nba/eng.1 leaders return
Leader[] JSON, unknown key 404s, other /api/* still proxied.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChocVWiknZXDoEx8ZcZHe3
EOF
)"
```

---

### Task 4: 注册表 `leadersSource` 字段 + 打开 eng.1/nba scorers + 删死字段 + i18n

**Files:**
- Modify: `src/competitions.ts`（加 `leadersSource?`；eng.1/nba `scorers:false→true`；删 `capabilities.leaders`）
- Modify: `src/competitions.test.ts`（更新 capabilities 断言 + 新增 leadersSource 断言）
- Modify: `src/i18n/messages.ts`（新增 `fixtures.leaders` + `leaders.points` ×4 语言）
- Test: `src/i18n/messages.test.ts`（键对齐自动把关，无需改）

**Interfaces:**
- Consumes: 现有 `Competition`/`COMPETITIONS`（`src/competitions.ts`）。
- Produces:
  - `Competition.leadersSource?: 'scoreboard' | 'pipeline'`；`fifa.world='scoreboard'`、`eng.1='pipeline'`、`nba='pipeline'`。
  - `Competition.capabilities` 删除 `leaders` 字段；eng.1/nba 的 `scorers` 变 `true`。
  - i18n key `fixtures.leaders`（篮球 tab 标签「Scoring Leaders」/「得分榜」…）、`leaders.points`（篮球统计列头「PTS」）。足球射手榜文案复用现有 `scorers.*`。

- [ ] **Step 1: 写失败测试** —— 在 `src/competitions.test.ts`：

1a. 把 `eng.1` describe 里的 `'hides bracket and scorers via capabilities'` 用例（当前第 42–45 行）**整体替换**为——scorers 现在开启、bracket 仍关：

```ts
  it('hides bracket but exposes scorers (leaders pipeline)', () => {
    expect(pl.capabilities.bracket).toBe(false);
    expect(pl.capabilities.scorers).toBe(true);
    expect(pl.leadersSource).toBe('pipeline');
  });
```

1b. 把 nba describe 里的 `'exposes only the boxscore capability'` 用例（当前第 84–92 行）**整体替换**为——去掉已删除的 `leaders` 字段、scorers 开启：

```ts
  it('exposes boxscore and scorers capabilities', () => {
    expect(nba.capabilities).toEqual({
      bracket: false,
      scorers: true,
      lineups: false,
      boxscore: true,
    });
    expect(nba.leadersSource).toBe('pipeline');
  });
```

1c. 在 `registry` describe 块（当前第 26–31 行）里追加一个 leadersSource 断言用例：

```ts
  it('marks the World Cup as scoreboard-sourced scorers', () => {
    expect(COMPETITIONS['fifa.world'].leadersSource).toBe('scoreboard');
    expect(COMPETITIONS['fifa.world'].capabilities.scorers).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/competitions.test.ts`
Expected: FAIL —— `pl.capabilities.scorers` 现为 `false`（期望 true）；`nba.capabilities` 仍含 `leaders` 键（`toEqual` 不匹配少了 `leaders` 的对象）；`leadersSource` 为 `undefined`。

- [ ] **Step 3: 改 `src/competitions.ts`** ——

3a. 从 `Competition.capabilities` 类型（当前第 19–25 行）删除 `leaders: boolean;` 行，并在 `capabilities` 之后加 `leadersSource?` 字段。把 interface 的这两处改为：

```ts
  shape: 'tournament' | 'season';
  capabilities: {
    bracket: boolean;
    scorers: boolean;
    lineups: boolean;
    boxscore: boolean;
  };
  // Where the scorers/leaders tab gets its data. 'scoreboard' = aggregated
  // from the scoreboard's per-team leaders (World Cup, unchanged). 'pipeline'
  // = server-side assembleLeaders over ESPN core.api (eng.1 goals / nba
  // points). Omit for comps with no leaders tab.
  leadersSource?: 'scoreboard' | 'pipeline';
```

3b. `fifa.world` 条目：删 `leaders: false,`，加 `leadersSource`。当前第 38 行：

```ts
    capabilities: { bracket: true, scorers: true, leaders: false, lineups: true, boxscore: false },
```

改为：

```ts
    capabilities: { bracket: true, scorers: true, lineups: true, boxscore: false },
    leadersSource: 'scoreboard',
```

3c. `eng.1` 条目：`scorers: false → true`、删 `leaders: false,`、加 `leadersSource`。当前第 48–54 行的 capabilities 块：

```ts
    capabilities: {
      bracket: false,
      scorers: false,
      leaders: false,
      lineups: true,
      boxscore: false,
    },
```

改为：

```ts
    capabilities: {
      bracket: false,
      scorers: true,
      lineups: true,
      boxscore: false,
    },
    leadersSource: 'pipeline',
```

3d. `nba` 条目：`scorers: false → true`、删 `leaders: false,`、加 `leadersSource`。当前第 65–71 行的 capabilities 块：

```ts
    capabilities: {
      bracket: false,
      scorers: false,
      leaders: false,
      lineups: false,
      boxscore: true,
    },
```

改为：

```ts
    capabilities: {
      bracket: false,
      scorers: true,
      lineups: false,
      boxscore: true,
    },
    leadersSource: 'pipeline',
```

- [ ] **Step 4: 加 i18n `fixtures.leaders` + `leaders.points`（四语）** —— 在 `src/i18n/messages.ts` 每种语言对象里：

4a. 紧跟每语言的 `'fixtures.scorers'` 那行之后各加一条 `'fixtures.leaders'`（篮球 tab / 列头用「得分榜」，与足球「射手榜」区分）：

```
en (after line 42 'fixtures.scorers': 'Scorers',):  'fixtures.leaders': 'Scoring Leaders',
zh (after line 147 'fixtures.scorers': '射手榜',):    'fixtures.leaders': '得分榜',
ja (after line 252 'fixtures.scorers': '得点ランキング',): 'fixtures.leaders': '得点ランキング',
ko (after 'fixtures.scorers' in ko):                  'fixtures.leaders': '득점 순위',
```

4b. 紧跟每语言的 `'scorers.goals'` 那行之后各加一条 `'leaders.points'`（篮球得分列头）：

```
en (after line 108 'scorers.goals': 'G',):  'leaders.points': 'PTS',
zh (after line 213 'scorers.goals': '进球',): 'leaders.points': '得分',
ja (after line 254-area 'scorers.goals': ...): 'leaders.points': '得点',
ko (after 'scorers.goals' in ko):             'leaders.points': '득점',
```

> ko 的具体行号未在本计划中枚举——执行者按「每语言对象里 `fixtures.scorers` / `scorers.goals` 的下一行」定位；四语必须都加，否则 `messages.test.ts` 键对齐失败。`leaders.rank`/`leaders.player`/`leaders.team` 复用现有 `scorers.rank`/`scorers.player`/`scorers.team`（Task 6 的 LeadersView 用）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/competitions.test.ts src/i18n/messages.test.ts`
Expected: PASS —— competitions 断言（scorers true、无 leaders 字段、leadersSource）全绿；i18n 四语键对齐全绿。

- [ ] **Step 6: 全量 typecheck + lint（确认删字段无残留引用）**

Run: `npm run typecheck && npm run lint`
Expected: 无错误。若任何文件仍读 `capabilities.leaders`，typecheck 会报「属性不存在」——已确认全仓库无读取点（只有声明/赋值/测试断言），本任务已一并清理。

- [ ] **Step 7: 提交**

```bash
git add src/competitions.ts src/competitions.test.ts src/i18n/messages.ts
git commit -m "$(cat <<'EOF'
feat(competitions): leadersSource field, enable eng.1/nba scorers, drop dead leaders cap

Add leadersSource ('scoreboard' | 'pipeline'): fifa.world=scoreboard,
eng.1/nba=pipeline. Flip eng.1 and nba scorers capability to true so the
Header tab shows. Delete the never-read capabilities.leaders field. Add
i18n fixtures.leaders + leaders.points across en/zh/ja/ko.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChocVWiknZXDoEx8ZcZHe3
EOF
)"
```

---

### Task 5: `useLeaders` hook

**Files:**
- Create: `src/hooks/useLeaders.ts`
- Create: `src/hooks/useLeaders.test.ts`

**Interfaces:**
- Consumes: `Leader`（`src/types`，Task 1）。
- Produces: `useLeaders(comp: string): { leaders: Leader[]; loading: boolean; error: string | null; refetch: () => void }`。SWR + 可见性门控轮询（60s）+ AbortController（沿用 `useStreams` 模式）。请求 `/api/${comp}/leaders`。

- [ ] **Step 1: 写失败测试 `src/hooks/useLeaders.test.ts`** —— fetch mock，验证：初次加载填充 leaders、错误态、非 ok 报错。用 `@testing-library/react` 的 `renderHook`/`waitFor`。

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLeaders } from './useLeaders';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  // jsdom defaults visibilityState to 'visible'
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sample = [
  { rank: 1, name: 'Erling Haaland', teamName: 'Man City', teamLogo: 'mci.png', displayValue: '27', value: 27 },
  { rank: 2, name: 'Bukayo Saka', teamName: 'Arsenal', teamLogo: 'ars.png', displayValue: '18', value: 18 },
];

describe('useLeaders', () => {
  it('fetches /api/<comp>/leaders and exposes the Leader[]', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => sample });
    const { result } = renderHook(() => useLeaders('eng.1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/eng.1/leaders', expect.any(Object));
    expect(result.current.leaders).toEqual(sample);
    expect(result.current.error).toBeNull();
  });

  it('sets an error when the response is not ok and there is no cache', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const { result } = renderHook(() => useLeaders('nba'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load leaders');
    expect(result.current.leaders).toEqual([]);
  });

  it('sets an error when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useLeaders('nba'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useLeaders.test.ts`
Expected: FAIL —— `./useLeaders` 模块不存在。

- [ ] **Step 3: 写 `src/hooks/useLeaders.ts`** —— 结构镜像 `useStreams`（SWR cache-ref + initialRef + AbortController + 60s 可见性门控轮询）：

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Leader } from '../types';

// Season leaders (eng.1 goals / nba points) from the server-side pipeline
// (/api/<comp>/leaders → Worker cachedProducer → assembleLeaders). Only called
// when COMPETITIONS[comp].leadersSource === 'pipeline' (the World Cup keeps its
// scoreboard-sourced scorers). Same SWR + visibility-gated polling +
// AbortController pattern as useStreams; season stats change slowly so we poll
// at 60s.
export function useLeaders(comp: string) {
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: Leader[]; ts: number } | null>(null);
  const initialRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (cacheRef.current && !initialRef.current) {
      setLeaders(cacheRef.current.data);
      setLoading(false);
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    if (initialRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const res = await fetch(`/api/${comp}/leaders`, { signal });
      if (signal.aborted) return;
      if (!res.ok) throw new Error('Failed to load leaders');
      const data = (await res.json()) as Leader[];
      if (signal.aborted) return;
      cacheRef.current = { data, ts: Date.now() };
      setLeaders(data);
      setError(null);
    } catch (err: unknown) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      console.error('useLeaders fetch failed:', err);
      if (!cacheRef.current) setError(err instanceof Error ? err.message : 'Failed to load leaders');
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        initialRef.current = false;
      }
    }
  }, [comp]);

  useEffect(() => {
    fetchData();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 60_000);
    return () => {
      abortRef.current?.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchData]);

  return { leaders, loading, error, refetch: fetchData };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useLeaders.test.ts`
Expected: PASS（加载填充、非 ok 报「Failed to load leaders」、reject 报 message）。

- [ ] **Step 5: 全量 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/hooks/useLeaders.ts src/hooks/useLeaders.test.ts
git commit -m "$(cat <<'EOF'
feat(hooks): useLeaders — SWR pipeline leaders hook

useLeaders(comp) fetches /api/<comp>/leaders with the useStreams SWR +
visibility-gated polling (60s) + AbortController pattern. Only used for
leadersSource==='pipeline' comps.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChocVWiknZXDoEx8ZcZHe3
EOF
)"
```

---

### Task 6: `LeadersView`（泛化 TopScorersView）+ `FixturesView` 按 `leadersSource` 分叉

**Files:**
- Create: `src/components/LeadersView.tsx`
- Create: `src/components/LeadersView.test.tsx`
- Delete: `src/components/TopScorersView.tsx`（被 `LeadersView` 取代）
- Delete: `src/components/TopScorersView.test.tsx`（用例迁入 `LeadersView.test.tsx`）
- Modify: `src/components/FixturesView.tsx`（scorers tab 按 `leadersSource` 分叉；WC 映射 TopScorer→Leader，pipeline 用 useLeaders；渲染 `LeadersView`）
- Modify: `src/components/FixturesView.test.tsx`（scorers 用例更新为 `LeadersView` 渲染）

**Interfaces:**
- Consumes: `Leader`（`src/types`，Task 1）、`TopScorer`（`src/types`）、`useLeaders`（Task 5）、`COMPETITIONS`（Task 4，带 `leadersSource`）、`useCompetition().scorers`（`TopScorer[]`）。
- Produces:
  - `LeadersView`（default export）：props `{ leaders: Leader[]; statLabelKey: string; empty: string }`——渲染排名列表（名次、队徽、球员名、球队、`displayValue`）；行**不可点击**（纯 `<tr>`，无 onClick/button/link）；统计列头文案由 `statLabelKey` 决定（足球 `scorers.goals`、篮球 `leaders.points`），空态文案由 `empty` 决定。
  - `FixturesView` scorers 分支：`leadersSource==='scoreboard'` → 把 `scorers: TopScorer[]` 映射为 `Leader[]`（`rank=i+1`, `name`, `teamName`, `teamLogo=teamFlag`, `displayValue=String(goals)`, `value=goals`）；`leadersSource==='pipeline'` → 用 `useLeaders(comp)` 的 `Leader[]`。两者都渲染 `LeadersView`。

- [ ] **Step 1: 写 `LeadersView` 失败测试 `src/components/LeadersView.test.tsx`** —— 迁移 TopScorersView 的用例并加「行不可点击」断言。完整内容：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { Leader } from '../types';
import LeadersView from './LeadersView';

function renderView(leaders: Leader[], statLabelKey = 'scorers.goals', empty = 'No goals scored yet') {
  return render(
    <LanguageProvider>
      <LeadersView leaders={leaders} statLabelKey={statLabelKey} empty={empty} />
    </LanguageProvider>,
  );
}

const rows: Leader[] = [
  { rank: 1, name: 'Erling Haaland', teamName: 'Norway', teamLogo: '', displayValue: '4', value: 4 },
  { rank: 2, name: 'Kylian Mbappé', teamName: 'France', teamLogo: '', displayValue: '3', value: 3 },
  { rank: 3, name: 'Mohamed Salah', teamName: 'Egypt', teamLogo: '', displayValue: '2', value: 2 },
];

describe('LeadersView', () => {
  it('shows the provided empty message when there are no leaders', () => {
    renderView([], 'scorers.goals', 'No goals scored yet');
    expect(screen.getByText('No goals scored yet')).toBeInTheDocument();
  });

  it('renders each leader with rank, name, team, and displayValue', () => {
    renderView(rows);
    expect(screen.getByText('Erling Haaland')).toBeInTheDocument();
    expect(screen.getByText('Kylian Mbappé')).toBeInTheDocument();
    expect(screen.getByText('Mohamed Salah')).toBeInTheDocument();
    expect(screen.getAllByText('Norway').length).toBeGreaterThan(0);
    expect(screen.getAllByText('France').length).toBeGreaterThan(0);
    // The value cell shows displayValue in a bold tabular cell.
    const valueCells = screen.getAllByRole('cell').filter((c) => c.className.includes('font-bold'));
    expect(valueCells.map((c) => c.textContent)).toEqual(['4', '3', '2']);
  });

  it('numbers rows from the Leader.rank field', () => {
    renderView(rows);
    const trs = screen.getAllByRole('row');
    // trs[0] = header row, trs[1..] = leader rows
    expect(trs[1]?.textContent).toMatch(/^1/);
    expect(trs[2]?.textContent).toMatch(/^2/);
  });

  it('renders the column header from statLabelKey (basketball → PTS)', () => {
    renderView(rows, 'leaders.points', 'No stats yet');
    expect(screen.getByRole('columnheader', { name: 'PTS' })).toBeInTheDocument();
  });

  it('renders no clickable rows (no buttons or links)', () => {
    renderView(rows);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/components/LeadersView.test.tsx`
Expected: FAIL —— `./LeadersView` 模块不存在。

- [ ] **Step 3: 写 `src/components/LeadersView.tsx`** —— 由 `TopScorersView` 泛化：`scorers.goals`→`s.displayValue`、`s.athleteId`→`Leader.rank` 作 key、列头文案参数化、空态参数化。行仍是纯 `<tr>`（原本就无 onClick，符合「不可点击」）。完整代码：

```tsx
import { useT } from '../i18n';
import type { Leader } from '../types';

// Season leaderboard (eng.1 goals / nba points, and — via a TopScorer→Leader
// map at the call site — the World Cup scorers). Rows are NOT clickable
// (spec §2: no player-page nav from the board). `statLabelKey` picks the value
// column header (scorers.goals / leaders.points); `empty` is the empty-state
// message.
export default function LeadersView({
  leaders,
  statLabelKey,
  empty,
}: {
  leaders: Leader[];
  statLabelKey: string;
  empty: string;
}) {
  const t = useT();

  if (leaders.length === 0) {
    return <p className="font-mono text-xs tracking-wider text-chalkdim">{empty}</p>;
  }

  return (
    <div className="space-y-card">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display font-bold text-lg text-chalk tracking-wide">
          {t('scorers.title')}
        </h3>
        <span className="ds-caption uppercase tracking-[0.2em] text-chalkdim/60">
          {t('scorers.subtitle')}
        </span>
      </div>

      <table className="w-full text-sm border border-line/30 bg-panel/85 rounded-card overflow-hidden shadow-panel backdrop-blur-sm">
        <caption className="sr-only">{t('scorers.title')}</caption>
        <thead className="text-chalkdim ds-caption uppercase tracking-[0.18em]">
          <tr className="border-b border-overlay/5 bg-overlay/[0.02]">
            <th scope="col" className="text-left font-medium px-3 py-2 w-10">
              {t('scorers.rank')}
            </th>
            <th scope="col" className="text-left font-medium px-3 py-2">
              {t('scorers.player')}
            </th>
            <th scope="col" className="text-left font-medium px-3 py-2 hidden sm:table-cell">
              {t('scorers.team')}
            </th>
            <th scope="col" className="text-right font-medium px-3 py-2 w-16">
              {t(statLabelKey)}
            </th>
          </tr>
        </thead>
        <tbody>
          {leaders.map((l) => {
            const isLeader = l.rank === 1;
            return (
              <tr
                key={l.rank}
                className={`border-b border-overlay/5 last:border-b-0 ${isLeader ? 'bg-pitch/5' : ''}`}
              >
                <td className="px-3 py-2 font-mono tabular-nums text-chalkdim">{l.rank}</td>
                <td className="px-3 py-2 font-display text-chalk truncate max-w-0">
                  {l.name}
                  <span className="flex items-center gap-1 sm:hidden ds-caption text-chalkdim/70">
                    {l.teamLogo && (
                      <img
                        src={l.teamLogo}
                        alt=""
                        className="w-3.5 h-2.5 object-cover rounded-micro shrink-0"
                      />
                    )}
                    <span className="truncate">{l.teamName}</span>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-chalkdim truncate max-w-0 hidden sm:table-cell">
                  <span className="flex items-center gap-1.5">
                    {l.teamLogo && (
                      <img
                        src={l.teamLogo}
                        alt=""
                        className="w-4 h-3 object-cover rounded-micro shrink-0"
                      />
                    )}
                    <span className="truncate">{l.teamName}</span>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-base sm:text-lg font-bold text-chalk tabular-nums text-right">
                  {l.displayValue}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: 删除 `TopScorersView` 及其测试** ——

```bash
git rm src/components/TopScorersView.tsx src/components/TopScorersView.test.tsx
```

- [ ] **Step 5: 改 `FixturesView` scorers 分支** —— 在 `src/components/FixturesView.tsx`：

5a. 导入：把 `import TopScorersView from './TopScorersView';`（当前第 11 行）替换为：

```ts
import LeadersView from './LeadersView';
```

并在 `useLeaders` 导入（加一行）：

```ts
import { useLeaders } from '../hooks/useLeaders';
```

`Leader`/`TopScorer` 类型：把当前第 5 行 `import type { CompMatch, Stage, TopScorer } from '../types';` 改为：

```ts
import type { CompMatch, Leader, Stage, TopScorer } from '../types';
```

5b. 在 `const shape = competition?.shape ?? 'tournament';` 之后加两行——派生 `leadersSource`，并**无条件**调用 `useLeaders`（React 规则：hook 不能条件调用）：

```ts
  const leadersSource = competition?.leadersSource;
  // Hooks must run unconditionally. useLeaders always fetches /api/<comp>/leaders,
  // but we only READ its result on the pipeline branch below; scoreboard comps
  // (World Cup) map their `scorers` prop instead and ignore `pipeline`.
  const pipeline = useLeaders(comp);
```

> 关于「scoreboard comp 也发一次 `/leaders` 请求」：这是无条件调用 hook 的直接后果，但代价可忽略——请求 60s 一次、命中 Worker KV，对 `fifa.world`（tournament，core.api 该端点可能空/404）`assembleLeaders` 降级返回 `[]`，无副作用。**不**为此给 `useLeaders` 加 `enabled` 开关（YAGNI）；恒定调用 + 只在 pipeline 分支读取即可。

5c. 把 scorers 渲染分支（当前第 170–171 行）：

```tsx
        {effectiveSection === 'scorers' ? (
          <TopScorersView scorers={scorers} />
```

替换为——按 `leadersSource` 分叉，两条路都渲染 `LeadersView`：

```tsx
        {effectiveSection === 'scorers' ? (
          leadersSource === 'pipeline' ? (
            <LeadersView
              leaders={pipeline.leaders}
              statLabelKey={competition?.sport === 'basketball' ? 'leaders.points' : 'scorers.goals'}
              empty={t('scorers.empty')}
            />
          ) : (
            <LeadersView
              leaders={scorersToLeaders(scorers)}
              statLabelKey="scorers.goals"
              empty={t('scorers.empty')}
            />
          )
```

5d. 在文件顶部（组件函数之外，`KNOWN_STAGES` 常量附近）加纯映射辅助 `scorersToLeaders`（WC `TopScorer[]`→`Leader[]`，spec §4.1）：

```ts
// World Cup keeps its scoreboard-sourced TopScorer[]; normalize it to the
// shared Leader[] shape at the render boundary (data path unchanged).
function scorersToLeaders(scorers: TopScorer[]): Leader[] {
  return scorers.map((s, i) => ({
    rank: i + 1,
    name: s.name,
    teamName: s.teamName,
    teamLogo: s.teamFlag,
    displayValue: String(s.goals),
    value: s.goals,
  }));
}
```

- [ ] **Step 6: 更新 `FixturesView.test.tsx`** —— 现有 scorers 相关断言依赖 `TopScorersView`。当前测试文件里 `renderView` 传 `scorers: never[]`，且没有直接测 scorers tab（section 恒为 `'matches'`）。检查：`FixturesView.test.tsx` 现有用例 section 都是 `'matches'`/`'bracket'`，无 `'scorers'` section 用例——故无需改现有断言。但需追加一个 scorers-tab 用例覆盖两条分叉。追加到文件末尾：

```tsx
import type { Leader, TopScorer } from '../types';

// scoreboard-sourced (World Cup): scorers prop is mapped to Leader rows.
it('renders scoreboard-sourced scorers as a leaders board (World Cup)', () => {
  setPath('/fifa.world');
  const scorers: TopScorer[] = [
    { athleteId: '1', name: 'Erling Haaland', teamId: '464', teamName: 'Norway', teamFlag: '', goals: 4 },
  ];
  render(
    <LanguageProvider>
      <FixturesView
        section="scorers"
        matches={[]}
        standings={{ kind: 'soccer', groups: [] }}
        scorers={scorers}
      />
    </LanguageProvider>,
  );
  expect(screen.getByText('Erling Haaland')).toBeInTheDocument();
  // value cell shows the goal count as displayValue
  const cells = screen.getAllByRole('cell').filter((c) => c.className.includes('font-bold'));
  expect(cells.map((c) => c.textContent)).toEqual(['4']);
});
```

> pipeline 分支（eng.1/nba）在组件里调用 `useLeaders` → `fetch`；`FixturesView.test.tsx` 未 stub 全局 fetch，直接渲染 pipeline comp 的 scorers tab 会触发真实 fetch（jsdom 无网络 → reject，被 hook 吞掉，`leaders` 保持 `[]` → 渲染空态）。为避免脆弱性，pipeline 分支的行为已由 `useLeaders.test.ts`（Task 5）+ `LeadersView.test.tsx`（本任务）分别覆盖，此处不重复渲染 pipeline comp。若要断言分叉选择逻辑，上面的 scoreboard 用例已证明「section=scorers → 渲染 LeadersView 而非 TopScorersView」。

- [ ] **Step 7: 跑全量测试确认通过**

Run: `npx vitest run`
Expected: PASS —— `LeadersView.test.tsx`（含不可点击断言）全绿；`FixturesView.test.tsx` 现有用例 + 新 scoreboard scorers 用例全绿；`TopScorersView.test.tsx` 已删除不再运行。总测试数 = 基线 277 − TopScorersView 的 4 个 + LeadersView 的 5 个 + FixturesView +1 + 前序任务新增。

- [ ] **Step 8: 全量 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 无错误（无残留 `TopScorersView` 引用；`Leader`/`TopScorer` 导入正确）。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(views): LeadersView + FixturesView branch on leadersSource

Generalize TopScorersView into LeadersView (renders Leader[], value column via
statLabelKey, empty via prop, rows still not clickable). FixturesView scorers
tab branches on leadersSource: scoreboard (World Cup) maps TopScorer→Leader at
the render boundary; pipeline (eng.1/nba) uses useLeaders. Delete TopScorersView.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChocVWiknZXDoEx8ZcZHe3
EOF
)"
```

---

## 自检（against spec）

- **覆盖**：spec §4.1 Leader（Task 1）、§4.2 assembleLeaders+LEADERS_BY_SPORT（Task 1）、§4.3 cachedProducer+leaders 路由（Task 2）、§4.4 vite 中间件（Task 3）、§4.5 useLeaders+LeadersView+FixturesView 分叉（Task 5/6）、§4.6 leadersSource+开 scorers+删 leaders 死字段（Task 4）、§4.7 i18n（Task 4）。§6 测试全部落到对应任务；§7 风险：core.api 可达性靠 Task 3 手测 + Cloudflare preview；子请求上限由 topN=15+去重+并发 10 保证；dev 中间件 API 已核对；serve-stale 由 `leadersProducer` probe-rethrow 实现。
- **契约名一致性**：`Leader`（rank/name/teamName/teamLogo/displayValue/value）、`LeadersConfig`（sport/league/season/type/category/topN）、`assembleLeaders(fetchImpl, cfg)`、`LEADERS_BY_SPORT`、`cachedProducer(cacheKey, producer, fresh, keep, env, ctx)`、`leadersSource: 'scoreboard'|'pipeline'` 在所有任务/测试/代码块中拼写与字段完全一致——已逐处核对。
- **占位符扫描**：无 TBD/TODO/"similar to"；每处代码块均为完整可粘贴代码或带 before→after 的精确 quote。
- **绿态序列**：Task 1（新增，独立绿）→ Task 2（worker，依赖 Task 1 的 leaders.ts，绿）→ Task 3（vite，依赖 Task 1，绿）→ Task 4（注册表，独立，绿）→ Task 5（hook，依赖 Task 1，绿）→ Task 6（视图，依赖 Task 1/4/5，绿）。每任务末 `npx vitest run + npm run typecheck + npm run lint`。
- **非目标**：单类别（LEADERS_BY_SPORT 每 sport 一条）；WC scoreboard 路径未动（仅 scorersToLeaders 在渲染入口映射）；行不可点击（LeadersView 无 onClick/button/link + 测试断言）；dev 不缓存（中间件每次实算）；capabilities.leaders 已删。
