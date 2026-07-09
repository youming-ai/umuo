# Unified Data Layer (Migration Plan 2 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the SWR primitives + composed `serve*` functions out of `worker/index.ts` into a shared `src/data/api.ts` module so Astro SSR pages can call them directly via `Astro.locals.runtime.env.CACHE` (with the same KV cache, request coalescing, and serve-stale-on-outage semantics the worker uses today). The worker becomes a thin HTTP wrapper. **No client changes, no API contract changes** — `worker/index.test.ts` continues to pass unchanged by having the worker re-export the moved symbols.

**Architecture:** The current `worker/index.ts` mixes (a) pure data-fetching code (SWR + cache + URL builder + leaders producer) with (b) HTTP routing (URL parsing → `serve*` calls). This plan lifts (a) into `src/data/api.ts`, so the same code is callable from:
- the worker's HTTP `fetch` handler (this plan), and
- Astro pages at SSR time (later per-page plans — the wiring is enabled by this plan's extraction but no SSR pages are added here).

ESPN parsing (`adapters/`, `competitions`, `leaders`, `news`) is already shared and untouched. Per-page SSR composes the data layer with the adapters at render time (later plans).

**Tech Stack:** Astro 5, Cloudflare adapter, TypeScript, Vitest, npm. No new dependencies.

## Global Constraints

- **Public API of the worker is unchanged.** `worker/index.ts` still exports `default { fetch }`, plus named exports `json`, `serve`, `serveSummary`, `serveLeaders`, `serveNews`, and the `Env` type — so `worker/index.test.ts` (and any future consumer) keeps working without churn.
- **No client changes.** No hook / component / type under `src/components/`, `src/hooks/`, `src/adapters/`, `src/i18n/`, `src/theme/`, `src/utils/`, `src/App.tsx`, or `src/main.tsx` (the last is already deleted in the skeleton plan) is touched.
- **No new dependencies.**
- **All 349 existing tests must stay green.** Most importantly `worker/index.test.ts` continues to pass without modification (because the worker re-exports).
- **Astro build must stay green** (Task 1 adds a file inside `src/`, which is now compiled under `tsconfig.json` per the skeleton plan's Step 4; the new file must compile under both `tsconfig.json` and `tsconfig.worker.json`).
- **The live smoke (`/api/*` + SPA catch-all) must still work** after the extraction.

## File Structure

- Create: `src/data/api.ts` — the moved SWR primitives + composed `serve*` + `json` + `Env` + `Entry` + `CachedResult` + `inflight` + `TTL` + `fetchWithRetry`
- Modify: `worker/index.ts` — keep only the default `fetch` HTTP routing; re-export the moved public surface (`json`, `serve`, `serveSummary`, `serveLeaders`, `serveNews`, `Env`) so the worker test passes unmodified
- Keep untouched: every other file, including `src/competitions.ts`, `src/leaders.ts`, `src/news.ts`, `src/newsFeed.ts`, `src/adapters/*`, all hooks, all components, all layouts/pages/api routes, the `astro.config.mjs`, `tsconfig.json`, `tsconfig.worker.json`, `wrangler.jsonc`, `package.json`, and the plan/spec docs.

---

### Task 1: Create `src/data/api.ts` (lift the data layer)

**Files:**
- Create: `src/data/api.ts`

**Interfaces:**
- Consumes: `../competitions` (`COMPETITIONS`, `Competition`, `Resource`, `buildUrl`, `seasonForDate`), `../leaders` (`assembleLeaders`, `LEADERS_BY_SPORT`), `../news` (`buildNewsUrl`, `newsCacheKey`, `newsFresh`, `newsParamsFromQuery`).
- Produces: a module that compiles under both `tsconfig.json` (app — DOM + @cloudflare/workers-types) AND `tsconfig.worker.json` (worker — ES2024 + @cloudflare/workers-types via `worker-configuration.d.ts` reference). It must export exactly the same named surface that `worker/index.ts` exports today (`json`, `serve`, `serveSummary`, `serveLeaders`, `serveNews`, `Env`, plus the internal helpers `runCached`/`cached`/`cachedProducer` as non-exported helpers).

- [ ] **Step 1: Create `src/data/api.ts` with the lifted code**

Write the file with this exact content (the move is byte-for-byte identical except for the import paths and a `/// <reference types="@cloudflare/workers-types" />` triple-slash at the top to keep types resolvable under the app tsconfig that doesn't include `worker-configuration.d.ts`):

```ts
/// <reference types="@cloudflare/workers-types" />

import {
  type Competition,
  COMPETITIONS,
  type Resource,
  buildUrl,
  seasonForDate,
} from '../competitions';
import { assembleLeaders, LEADERS_BY_SPORT } from '../leaders';
import { buildNewsUrl, newsCacheKey, newsFresh, newsParamsFromQuery } from '../news';

// Edge cache for the upstream data APIs. The SPA calls same-origin /api/*; the
// Worker fetches the third-party source and caches the body in KV. Now lifted
// out of `worker/index.ts` so Astro SSR pages can call these functions
// directly (Astro.locals.runtime.env.CACHE + ctx) and share the same KV cache
// + in-flight coalescing + serve-stale-on-outage semantics.
//
// `fresh` = seconds a cached copy is served without revalidating.
// `keep`  = how long KV retains it (≥ fresh) so a stale copy can cover an outage.
// KV TTL minimum is 60s.

async function fetchWithRetry(url: string, init: RequestInit, retries = 1): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || i === retries) return res;
      // 仅对 5xx 重试
      if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

export interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
}

interface Entry {
  body: string;
  at: number;
}

type CacheState = 'HIT' | 'MISS' | 'REVALIDATED' | 'STALE';

interface CachedResult {
  body: string;
  status: number;
  cache: CacheState;
}

// Per-resource cache TTLs (seconds). `fresh` = served without revalidating;
// `keep` = how long KV retains a copy so a stale one can cover an outage.
// Scoreboard refreshes often (live scores), standings change slowly, summary
// is per-event. ppv.to streams are still fetched browser-side (datacenter-IP
// blocked), so they never touch this layer.
const TTL: Record<Resource, { fresh: number; keep: number }> = {
  scoreboard: { fresh: 60, keep: 86400 },
  standings: { fresh: 300, keep: 86400 },
  summary: { fresh: 30, keep: 86400 },
};

export function json(body: string, status: number, cache: CacheState): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-cache': cache },
  });
}

// Request coalescing: concurrent callers share one upstream fetch and one
// cached payload (a plain {body, status, cache} object — JSON-safe, not a
// stream). Each caller then calls `json(...)` to build its OWN `Response`
// from that shared payload; we never share the Response itself, because
// `Response#body` is a one-shot stream and a second `.text()` would throw
// `Body is unusable: Body has already been read`.
const inflight = new Map<string, Promise<CachedResult>>();

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
      console.error(`[data] produce failed for ${cacheKey}:`, err);
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

export async function serve(
  comp: Competition,
  resource: 'scoreboard' | 'standings',
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { fresh, keep } = TTL[resource];
  return cached(`${comp.key}:${resource}`, buildUrl(comp, resource), fresh, keep, env, ctx);
}

export async function serveSummary(
  comp: Competition,
  eventId: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!/^\d+$/.test(eventId)) return json('{"error":"bad event id"}', 400, 'MISS');
  const { fresh, keep } = TTL.summary;
  return cached(
    `summary:${comp.key}:${eventId}`,
    buildUrl(comp, 'summary', eventId),
    fresh,
    keep,
    env,
    ctx,
  );
}

// Season leaders (eng.1 goals / nba points): aggregated by assembleLeaders from
// ESPN's core.api (leaders doc + athlete/team $ref fan-out). We cache the
// PRODUCT (a Leader[]) via cachedProducer — not a single URL — so all the
// sub-requests collapse into one cached payload. Season stats change slowly:
// fresh 1h, keep 24h. assembleLeaders throws on a primary-doc failure (bad
// HTTP status or unparseable JSON), which lets serve-stale cover an outage
// instead of overwriting a valid stale leaderboard with an empty one
// (Finding 2) — only per-row $ref resolution failures degrade silently inside
// assembleLeaders. No separate probe/double-fetch: assembleLeaders is called
// directly.
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

Notes:
- The `/// <reference types="@cloudflare/workers-types" />` triple-slash is required because `src/data/api.ts` will be compiled under `tsconfig.json` (app), which per the skeleton plan declares `types: ["@cloudflare/workers-types"]` — but the file itself lives outside the `worker/` tree, so the per-file reference makes the types resolvable regardless of any future tsconfig include change.
- `Env` is exported. It's the same shape as today's worker (ASSETS + CACHE) so the worker test's `mockEnv()` continues to satisfy it.
- The `console.error` tag in `runCached` changes from `[worker]` to `[data]` to reflect the new location.
- Everything else is byte-for-byte the same as `worker/index.ts` today (including the Chinese comment `// 仅对 5xx 重试` and all the English comments).

- [ ] **Step 2: Verify the file compiles under both tsconfigs**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
```

Expected: both commands exit 0 with no errors. The new file references `KVNamespace`, `Fetcher`, `ExecutionContext` (from `@cloudflare/workers-types`); these are available in both tsconfigs.

- [ ] **Step 3: Commit (deferred — see Task 2)**

Per the project convention of one commit per task, the commit is at the end of Task 2 once both files have settled. This step intentionally makes no commit.

---

### Task 2: Slim `worker/index.ts` to an HTTP wrapper

**Files:**
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: the public surface exported by `../src/data/api` (`json`, `serve`, `serveSummary`, `serveLeaders`, `serveNews`, `Env`) and `../src/competitions` (`COMPETITIONS`).
- Produces: a thin HTTP wrapper that:
  1. Re-exports `json`, `serve`, `serveSummary`, `serveLeaders`, `serveNews`, and `Env` from `../src/data/api` (so `worker/index.test.ts`'s named imports keep working byte-for-byte).
  2. Default-exports `{ async fetch(request, env, ctx) }` that does ONLY URL parsing + dispatch (no inline fetch/cache logic).

- [ ] **Step 1: Replace `worker/index.ts` with the thin wrapper**

Write the file with this exact content:

```ts
/// <reference types="@cloudflare/workers-types" />

import { COMPETITIONS } from '../src/competitions';
import {
  type Env,
  json,
  serve,
  serveLeaders,
  serveNews,
  serveSummary,
} from '../src/data/api';

// Thin HTTP wrapper around the shared data layer (src/data/api.ts). The SWR
// primitives + composed serve* functions live there so Astro SSR pages can
// call them directly with Astro.locals.runtime.env.CACHE. This file only does
// URL parsing → serve* dispatch, and the SPA-fallback passthrough to ASSETS.

export { json, serve, serveSummary, serveLeaders, serveNews };
export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/news') {
      return serveNews(url.searchParams, env, ctx);
    }
    const m = url.pathname.match(/^\/api\/([^/]+)\/(scoreboard|standings|summary|leaders)$/);
    if (m) {
      if (!Object.hasOwn(COMPETITIONS, m[1])) return new Response('Not found', { status: 404 });
      const comp = COMPETITIONS[m[1]];
      const resource = m[2];
      if (resource === 'summary') {
        return serveSummary(comp, url.searchParams.get('event') ?? '', env, ctx);
      }
      if (resource === 'leaders') {
        return serveLeaders(comp, env, ctx);
      }
      return serve(comp, resource as 'scoreboard' | 'standings', env, ctx);
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request); // static assets + SPA fallback
  },
};
```

- [ ] **Step 2: Verify the worker still typechecks and the test suite still passes**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npx tsc -p tsconfig.worker.json --noEmit
npx vitest run 2>&1 | tail -10
```

Expected:
- `tsc` exit 0.
- Vitest reports `Test Files  40 passed (40)` and `Tests  349 passed (349)` (or close to that exact number — the plan's invariant is "no regression from the 349 baseline after the skeleton plan"). If the count is off, **stop and report** — that's a real finding.

The critical regression guard: `worker/index.test.ts`'s `import worker, { type Env, json, serve, serveLeaders, serveNews, serveSummary } from './index';` must resolve. The re-exports in this task's Step 1 make that work without touching the test.

- [ ] **Step 3: Full build + live smoke**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npm run build
npm run dev > /tmp/astro-dev.log 2>&1 &
DEV_PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/ >/dev/null 2>&1 && break
done
echo "--- /api/fifa.world/scoreboard ---"
curl -s "http://localhost:4321/api/fifa.world/scoreboard" | head -c 200
echo
echo "--- /api/news?leagues=nba&limit=2 ---"
curl -s "http://localhost:4321/api/news?leagues=nba&limit=2" | head -c 200
echo
echo "--- /fifa.world status code ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world"
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected: `npm run build` exits 0 (0 errors). The two `/api` curls return valid JSON. `/fifa.world` returns 200. Then kill the dev server. If any check fails, **stop and report** — that's a real finding.

- [ ] **Step 4: Commit**

```bash
cd /Users/youming/GitHub/youming-ai/cup
git add src/data/api.ts worker/index.ts
git commit -m "refactor(data): lift SWR primitives to src/data/api.ts; worker is now an HTTP wrapper

The data layer (runCached, cached, cachedProducer, fetchWithRetry, json, TTL,
serve, serveSummary, serveLeaders, serveNews, Env) moves out of
worker/index.ts into src/data/api.ts so Astro SSR pages can call the same
data functions directly with Astro.locals.runtime.env.CACHE. No client
changes, no API contract changes — worker re-exports the moved public
surface so worker/index.test.ts (and any future consumer) keeps working
without churn.

ESPN parsing (adapters/competitions/leaders/news) is untouched — those
modules were already shared. Per-page SSR plans compose the data layer with
the adapters at render time; this plan enables that wiring without adding
any new pages."
```

---

## Self-Review

**1. Spec coverage (design §1 + §4 step 2 "Unified data layer"):**
- `runCached`/`serve*` extracted out of `worker/index.ts` into a shared module → Task 1 ✓
- Both consumers wired:
  - Worker (`/api/*` HTTP routing) → Task 2 (worker imports from new module) ✓
  - Astro SSR (future per-page plans) → enabled by this plan; no SSR pages added here, per spec §4 ("multiple plans — skeleton, unified data layer, then one per page group") ✓
- `worker/index.ts` becomes a thin HTTP wrapper over the shared data functions → Task 2 ✓
- ESPN parsing untouched (already shared) → preserved by Global Constraints ✓

**2. Placeholder scan:** No TBD/TODO. All file contents given in full. No step has a deferred decision.

**3. Type/interface consistency:**
- `worker/index.ts` re-exports `json`, `serve`, `serveSummary`, `serveLeaders`, `serveNews`, `type Env` from `../src/data/api` — same names, same signatures. `worker/index.test.ts` imports them by those names from `./index` and the test file is NOT modified. ✓
- `Env` is `{ ASSETS: Fetcher; CACHE: KVNamespace }` in both old and new locations. The worker's test's `mockEnv()` returns `{ CACHE: { get, put } }` — still satisfies the interface (ASSETS isn't accessed in the data layer or the test). ✓
- `inflight` Map, `TTL`, `Entry`, `CachedResult` (renamed `CacheState` for the `x-cache` header values, but the `'HIT' | 'MISS' | 'REVALIDATED' | 'STALE'` union is identical) move with the primitives. The `x-cache` response header values are unchanged. ✓
- The cache key format is unchanged: `${comp.key}:${resource}` for scoreboard/standings/leaders, `summary:${comp.key}:${eventId}` for summary, `news:...` for news. The `worker/index.test.ts` test cases assert specific keys (`'fifa.world:standings'`, `'summary:fifa.world:760420'`, `'nba:leaders'`, `'news::::20'`, `'news::nba::10'`) — all produced by the new module unchanged. ✓

**Note on risk:** This is a pure code-motion refactor with no behavior change. The two risk points — (a) the worker test no longer resolving its named imports, and (b) the cache keys drifting from the test's hardcoded assertions — are both covered by Task 2 Step 2 (test run) and Task 2 Step 3 (live smoke). If either surfaces a regression, that's a real finding to fix in place.
