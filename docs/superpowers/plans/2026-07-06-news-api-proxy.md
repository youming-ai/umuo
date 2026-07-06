# News API Proxy (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/api/news` edge-cached proxy to the ESPN "now" news feed, supporting whitelisted global / sport / league / team filters, in both the production Worker and the local dev server.

**Architecture:** A new pure module `src/news.ts` is the single source of truth for the news upstream URL, param whitelist, cache TTL, and cache key — mirroring the existing `competitions.ts`/`leaders.ts` double-source discipline (compiled by both the app and worker tsconfigs, no DOM/React). The Worker adds a `serveNews` handler that reuses the existing `cached()` KV core. The dev server adds a `newsDevMiddleware` (mirroring the existing `leadersDevMiddleware`) because the news feed lives on a **different upstream host** (`now.core.api.espn.com`) than the fixed dev proxy target, so a URL rewrite can't reach it.

**Tech Stack:** TypeScript, Cloudflare Workers (`workerd`), Vite dev server + middleware, Vitest.

## Global Constraints

- Biome formatting: 2-space indent, single quotes, semicolons, trailing commas, line width 100. `style` rule group is off.
- Both tsconfigs must type-check: `npm run typecheck` runs `tsc` (app) **and** `tsc -p tsconfig.worker.json` (worker).
- Shared modules imported by the Worker must be pure — no DOM/React/browser APIs (same rule as `src/competitions.ts`, `src/leaders.ts`).
- Only whitelisted query params (`limit`, `sport`, `leagues`, `team`) may reach the upstream — arbitrary caller query must never be forwarded (trust boundary).
- `limit` is clamped to the range 1–50; default 20 (per PRD §2.1).
- Worker tests use `// @vitest-environment node` at the top of the file; app/pure-module tests run under jsdom (default). Tests are colocated as `*.test.ts`.
- **Already done — do NOT redo:** the PRD Phase-1 step "rename the wrangler namespace to `umuo`" is complete (`wrangler.jsonc:3` `name` is `"umuo"`; `vite.config.ts:52` `allowedHosts` is `umuo.app`). This plan covers only the remaining API-proxy work.
- **Out of scope (later phases):** any front-end (router routes, views, news TS types for the response body, Tag engine). Phase 1 delivers a transparent JSON proxy only — the Worker/dev server return ESPN's raw news JSON as a string.

---

### Task 1: `src/news.ts` — pure news URL + params + cache helpers

**Files:**
- Create: `src/news.ts`
- Test: `src/news.test.ts`

**Interfaces:**
- Consumes: nothing (standalone pure module; only `URLSearchParams`, a global).
- Produces:
  - `interface NewsParams { limit?: number; sport?: string; leagues?: string; team?: string }`
  - `newsParamsFromQuery(q: URLSearchParams): NewsParams` — whitelist + clamp
  - `buildNewsUrl(p: NewsParams): string` — the full upstream URL
  - `newsFresh(p: NewsParams): number` — TTL fresh seconds (120 global / 300 filtered)
  - `newsCacheKey(p: NewsParams): string` — stable KV key

- [ ] **Step 1: Write the failing test**

Create `src/news.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildNewsUrl, newsCacheKey, newsFresh, newsParamsFromQuery } from './news';

describe('newsParamsFromQuery', () => {
  it('defaults to empty params when there is no query', () => {
    expect(newsParamsFromQuery(new URLSearchParams(''))).toEqual({});
  });
  it('clamps limit to 50 and floors fractional values', () => {
    expect(newsParamsFromQuery(new URLSearchParams('limit=200')).limit).toBe(50);
    expect(newsParamsFromQuery(new URLSearchParams('limit=7.9')).limit).toBe(7);
  });
  it('ignores a non-positive or non-numeric limit', () => {
    expect(newsParamsFromQuery(new URLSearchParams('limit=0')).limit).toBeUndefined();
    expect(newsParamsFromQuery(new URLSearchParams('limit=abc')).limit).toBeUndefined();
  });
  it('whitelists only sport/leagues/team and drops anything else', () => {
    const p = newsParamsFromQuery(new URLSearchParams('sport=soccer&leagues=eng.1&team=che&evil=1'));
    expect(p).toEqual({ sport: 'soccer', leagues: 'eng.1', team: 'che' });
  });
});

describe('buildNewsUrl', () => {
  it('builds the global feed with default limit 20', () => {
    expect(buildNewsUrl({})).toBe('https://now.core.api.espn.com/v1/sports/news?limit=20');
  });
  it('appends whitelisted filters after the limit', () => {
    expect(buildNewsUrl({ limit: 10, leagues: 'nba' })).toBe(
      'https://now.core.api.espn.com/v1/sports/news?limit=10&leagues=nba',
    );
  });
});

describe('newsFresh', () => {
  it('is 120s for the unfiltered global feed', () => {
    expect(newsFresh({})).toBe(120);
  });
  it('is 300s once any filter is present', () => {
    expect(newsFresh({ leagues: 'nba' })).toBe(300);
  });
});

describe('newsCacheKey', () => {
  it('is stable and distinct per filter set', () => {
    expect(newsCacheKey({})).toBe('news::::20');
    expect(newsCacheKey({ leagues: 'nba', limit: 10 })).toBe('news::nba::10');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/news.test.ts`
Expected: FAIL — `Failed to resolve import "./news"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/news.ts`:

```ts
// Single source of truth for the ESPN "now" news feed URL, its param
// whitelist, cache TTL and cache key — shared by the Worker (worker/index.ts)
// and the Vite dev middleware (vite.config.ts). Same double-source discipline
// as competitions.ts/buildUrl and leaders.ts: pure, no DOM/React, so both
// build targets (app tsconfig + tsconfig.worker.json) compile it.

const NEWS = 'https://now.core.api.espn.com/v1/sports/news';

export interface NewsParams {
  limit?: number; // 1..50, default 20
  sport?: string; // ESPN sport slug, e.g. 'soccer' / 'basketball'
  leagues?: string; // ESPN league slug, e.g. 'nba' / 'eng.1'
  team?: string; // team abbreviation, e.g. 'che'
}

// Parse a request query into a WHITELISTED NewsParams — only these four keys
// ever reach the upstream, so arbitrary caller query can't be injected.
export function newsParamsFromQuery(q: URLSearchParams): NewsParams {
  const params: NewsParams = {};
  const limit = Number(q.get('limit'));
  if (Number.isFinite(limit) && limit > 0) params.limit = Math.min(Math.floor(limit), 50);
  const sport = q.get('sport');
  if (sport) params.sport = sport;
  const leagues = q.get('leagues');
  if (leagues) params.leagues = leagues;
  const team = q.get('team');
  if (team) params.team = team;
  return params;
}

export function buildNewsUrl(p: NewsParams): string {
  const q = new URLSearchParams();
  q.set('limit', String(p.limit ?? 20));
  if (p.sport) q.set('sport', p.sport);
  if (p.leagues) q.set('leagues', p.leagues);
  if (p.team) q.set('team', p.team);
  return `${NEWS}?${q}`;
}

// A feed filtered by sport/league/team changes more slowly than the global
// firehose, so it can stay fresh longer (PRD §5 cache table).
export function newsFresh(p: NewsParams): number {
  return p.sport || p.leagues || p.team ? 300 : 120;
}

// Stable KV key: same filters → same key regardless of original query order.
export function newsCacheKey(p: NewsParams): string {
  return `news:${p.sport ?? ''}:${p.leagues ?? ''}:${p.team ?? ''}:${p.limit ?? 20}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/news.test.ts`
Expected: PASS (all 4 describe blocks green).

- [ ] **Step 5: Type-check both targets**

Run: `npm run typecheck`
Expected: no errors (exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/news.ts src/news.test.ts
git commit -m "feat(news): pure news URL/params/cache helpers"
```

---

### Task 2: Worker `/api/news` route

**Files:**
- Modify: `worker/index.ts` (add import near line 10; add `serveNews` after `serveLeaders` ~line 239; add a route branch in `fetch` ~line 243)
- Test: `worker/index.test.ts` (add a `serveNews` describe block and one router test; extend the import on line 5)

**Interfaces:**
- Consumes (from Task 1): `buildNewsUrl`, `newsCacheKey`, `newsFresh`, `newsParamsFromQuery` from `../src/news`.
- Consumes (existing): `cached(cacheKey, url, fresh, keep, env, ctx)` — already in `worker/index.ts`.
- Produces: `serveNews(q: URLSearchParams, env: Env, ctx: ExecutionContext): Promise<Response>`, exported for tests.

- [ ] **Step 1: Write the failing test**

In `worker/index.test.ts`, extend the existing import on line 5 to add `serveNews`:

```ts
import worker, { type Env, json, serve, serveLeaders, serveNews, serveSummary } from './index';
```

Then append this describe block to the end of the file:

```ts
describe('serveNews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('proxies the global feed with default limit and stores under a news key', async () => {
    fetchMock.mockResolvedValue(new Response('{"headlines":[]}', { status: 200 }));
    const env = mockEnv(null);
    const ctx = mockCtx();
    const res = await serveNews(new URLSearchParams(''), env as unknown as Env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"headlines":[]}');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://now.core.api.espn.com/v1/sports/news?limit=20',
    );
    expect(env.CACHE.put).toHaveBeenCalledWith(
      'news::::20',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 86400 }),
    );
  });

  it('forwards the league filter and keys the cache distinctly', async () => {
    fetchMock.mockResolvedValue(new Response('{"headlines":[]}', { status: 200 }));
    const env = mockEnv(null);
    const ctx = mockCtx();
    await serveNews(new URLSearchParams('leagues=nba&limit=10'), env as unknown as Env, ctx);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('leagues=nba');
    expect(calledUrl).toContain('limit=10');
    expect(env.CACHE.put).toHaveBeenCalledWith(
      'news::nba::10',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 86400 }),
    );
  });

  it('routes GET /api/news through the fetch handler', async () => {
    fetchMock.mockResolvedValue(new Response('{"headlines":[]}', { status: 200 }));
    const env = mockEnv(null);
    const ctx = mockCtx();
    const res = await worker.fetch(
      new Request('https://x/api/news?sport=soccer'),
      env as unknown as Env,
      ctx,
    );
    expect(res.status).toBe(200);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('now.core.api.espn.com');
    expect(calledUrl).toContain('sport=soccer');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/index.test.ts`
Expected: FAIL — `serveNews` is not exported / not a function (import resolves to `undefined`).

- [ ] **Step 3: Add the import**

In `worker/index.ts`, directly below the existing `import { assembleLeaders, LEADERS_BY_SPORT } from '../src/leaders';` (line 10), add:

```ts
import { buildNewsUrl, newsCacheKey, newsFresh, newsParamsFromQuery } from '../src/news';
```

- [ ] **Step 4: Add the `serveNews` handler**

In `worker/index.ts`, immediately after the `serveLeaders` function (ends ~line 239, just before `export default {`), add:

```ts
// Global/sport/league/team news feed (ESPN "now" core API). Transparent JSON
// proxy: whitelist the query, fetch upstream, KV-cache the raw body under a
// stable news key. Filtered feeds change slower than the global firehose, so
// newsFresh() gives them a longer fresh window (PRD §5). keep is 1 day, matching
// the other resources.
export async function serveNews(
  q: URLSearchParams,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const params = newsParamsFromQuery(q);
  return cached(newsCacheKey(params), buildNewsUrl(params), newsFresh(params), 86400, env, ctx);
}
```

- [ ] **Step 5: Add the route branch**

In `worker/index.ts`, inside `fetch`, immediately after `const url = new URL(request.url);` (line 243) and BEFORE the two-segment `const m = url.pathname.match(...)` line, add:

```ts
    if (url.pathname === '/api/news') {
      return serveNews(url.searchParams, env, ctx);
    }
```

(This must come first: `/api/news` is single-segment and would otherwise fall through to the `/api/` → 404 branch, since the two-segment regex won't match it.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run worker/index.test.ts`
Expected: PASS (existing tests + the 3 new `serveNews` tests).

- [ ] **Step 7: Type-check both targets**

Run: `npm run typecheck`
Expected: no errors (exit 0).

- [ ] **Step 8: Commit**

```bash
git add worker/index.ts worker/index.test.ts
git commit -m "feat(news): edge-cached /api/news Worker route"
```

---

### Task 3: Dev-server news middleware

**Files:**
- Modify: `vite.config.ts` (extend the import on line 6; add `newsDevMiddleware` after `leadersDevMiddleware` ~line 47; register it in `plugins` on line 50)

**Interfaces:**
- Consumes (from Task 1): `buildNewsUrl`, `newsParamsFromQuery` from `./src/news`.
- Produces: a Vite plugin `newsDevMiddleware()` that intercepts `GET /api/news` in dev.

**Why a middleware, not a proxy rewrite:** the existing `server.proxy['/api']` has a fixed `target: 'https://site.api.espn.com'` and can only rewrite the path. The news feed is on a **different host** (`now.core.api.espn.com`), which a path rewrite can't reach. This mirrors why `leadersDevMiddleware` already exists.

- [ ] **Step 1: Extend the import**

In `vite.config.ts`, change the import on line 6 from:

```ts
import { assembleLeaders, LEADERS_BY_SPORT } from './src/leaders';
```

to add a second line below it:

```ts
import { assembleLeaders, LEADERS_BY_SPORT } from './src/leaders';
import { buildNewsUrl, newsParamsFromQuery } from './src/news';
```

- [ ] **Step 2: Add the middleware**

In `vite.config.ts`, immediately after the `leadersDevMiddleware` function closes (line 47, before `export default defineConfig({`), add:

```ts
// dev only: /api/news lives on a DIFFERENT upstream host (now.core.api.espn.com)
// than the fixed proxy target, so it can't be a path rewrite. Intercept it here
// and fetch the whitelisted URL directly. No caching in dev (that's the Worker's
// job in prod; see worker/index.ts serveNews).
function newsDevMiddleware(): import('vite').Plugin {
  return {
    name: 'news-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        if (url.pathname !== '/api/news') return next();
        try {
          const upstream = await globalThis.fetch(
            buildNewsUrl(newsParamsFromQuery(url.searchParams)),
          );
          const body = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(body);
        } catch (err) {
          console.error('[vite] news middleware failed:', err);
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end('{"error":"news unavailable"}');
        }
      });
    },
  };
}
```

- [ ] **Step 3: Register the plugin**

In `vite.config.ts`, change line 50 from:

```ts
  plugins: [react(), leadersDevMiddleware()],
```

to:

```ts
  plugins: [react(), leadersDevMiddleware(), newsDevMiddleware()],
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: no errors (exit 0).

- [ ] **Step 5: Manually verify against the live dev server**

Middleware isn't unit-tested (Vite plugin harness is heavier than the payoff); verify end-to-end instead.

Run in one terminal: `npm run dev`
Then in another: `curl -s "http://localhost:5173/api/news?leagues=nba&limit=3" | head -c 300`

Expected: a JSON body starting with `{"header"...` or `{"count"...`/`{"headlines":[...` (ESPN's news feed), NOT `{"error":"news unavailable"}` and NOT the SPA HTML. If the dev server chose a different port (e.g. 5174 when 5173 is busy), use that port.

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts
git commit -m "feat(news): dev-server /api/news middleware"
```

---

## Self-Review

**1. Spec coverage (PRD Phase 1 + API §2):**
- §2.1 global feed, default limit 20 / max 50 → Task 1 (`buildNewsUrl`, clamp) + Task 2 route ✓
- §2.2 `?sport=` filter → whitelist + passthrough ✓
- §2.3 `?leagues=` filter → whitelist + passthrough ✓
- §2.4 `?team=` filter → whitelist + passthrough ✓
- §5 cache table: news global fresh 120 / filtered 300, keep 24h → `newsFresh` + `serveNews` (keep 86400) ✓
- PRD Phase-1 "rename wrangler namespace to umuo" → already done (noted in Global Constraints), no task needed ✓
- PRD Phase-1 "dual TS check" → `npm run typecheck` step in every task ✓
- Header injection (API §1) → reused via existing `cached()` → `fetchWithRetry`, which already sets User-Agent/Accept/Accept-Language ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". All steps carry real code and exact commands. ✓

**3. Type consistency:** `NewsParams`, `newsParamsFromQuery`, `buildNewsUrl`, `newsFresh`, `newsCacheKey` are defined in Task 1 and consumed with identical names/signatures in Tasks 2 and 3. `serveNews(q, env, ctx)` defined in Task 2, called with the same shape in the router branch and tests. Cache keys asserted in Task 2 tests (`news::::20`, `news::nba::10`) match `newsCacheKey`'s format string. ✓

**Note on deferred concerns (from earlier architecture review, carry into later phases, not blockers here):** `/api/news` inherits the same *no auth / no rate-limit* exposure as the other endpoints — address at the Cloudflare WAF/Rate-Limiting layer before public launch. News response TS types and any front-end are intentionally deferred to Phase 2.
