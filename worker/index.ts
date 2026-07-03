/// <reference types="@cloudflare/workers-types" />

import {
  type Competition,
  COMPETITIONS,
  type Resource,
  buildUrl,
  seasonForDate,
} from '../src/competitions';
import { assembleLeaders, LEADERS_BY_SPORT } from '../src/leaders';

// Edge cache for the upstream data APIs. The SPA calls same-origin /api/*; this
// Worker fetches the third-party source and caches the body in KV, so the page
// is faster, doesn't depend on the upstream's CORS, and survives brief outages.
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

// Generated bindings from `worker-configuration.d.ts` already declare a global
// `interface Env`, but we re-declare and re-export it here so consumers of
// this module (notably the test suite) can import it as a named type.
export interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
}

interface Entry {
  body: string;
  at: number;
}

interface CachedResult {
  body: string;
  status: number;
  cache: string;
}

// Per-resource cache TTLs (seconds). `fresh` = served without revalidating;
// `keep` = how long KV retains a copy so a stale one can cover an outage.
// Scoreboard refreshes often (live scores), standings change slowly, summary
// is per-event. ppv.to streams are still fetched browser-side (datacenter-IP
// blocked), so they never touch this Worker.
const TTL: Record<Resource, { fresh: number; keep: number }> = {
  scoreboard: { fresh: 60, keep: 86400 },
  standings: { fresh: 300, keep: 86400 },
  summary: { fresh: 30, keep: 86400 },
};

export function json(body: string, status: number, cache: string): Response {
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
  return cachedProducer(`${comp.key}:leaders`, () => leadersProducer(cfg), 3600, 86400, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
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
