/// <reference types="@cloudflare/workers-types" />

import { getAdapter } from '../adapters';
import type { StandingsData } from '../adapters/types';
import {
  type Competition,
  type Resource,
  buildUrl,
  seasonForDate,
} from '../competitions';
import { assembleLeaders, LEADERS_BY_SPORT } from '../leaders';
import { buildNewsUrl, newsCacheKey, newsFresh, newsParamsFromQuery } from '../news';
import { parseNewsFeed } from '../newsFeed';
import type { CompMatch, Leader, NewsItem, TopScorer } from '../types';
import type { NewsParams } from '../news';

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

// Compose serveNews + parseNewsFeed into one SSR-friendly call. Returns the
// already-parsed NewsItem[] ready to render. Empty array on any failure
// (non-ok, JSON error, upstream {"error":...}). Used by the Astro news pages.
export async function fetchNewsItems(
  params: NewsParams,
  env: Env,
  ctx: ExecutionContext,
): Promise<NewsItem[]> {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.sport) q.set('sport', params.sport);
  if (params.leagues) q.set('leagues', params.leagues);
  if (params.team) q.set('team', params.team);
  const res = await serveNews(q, env, ctx);
  if (!res.ok) return [];
  try {
    const body = await res.text();
    const json: unknown = JSON.parse(body);
    if (json && typeof json === 'object' && 'error' in json) return [];
    return parseNewsFeed(json);
  } catch {
    return [];
  }
}

// Compose serve(scoreboard) + serve(standings) + the sport adapter into one
// ready-to-render CompetitionView. Used by the Astro competition pages to
// seed the island's useCompetition hook. Empty shape on any failure path.
export interface CompetitionView {
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
}

const EMPTY_COMPETITION_VIEW: CompetitionView = {
  matches: [],
  standings: { kind: 'soccer', groups: [] },
  scorers: [],
};

export async function getCompetitionView(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<CompetitionView> {
  try {
    const [sbRes, stRes] = await Promise.all([
      serve(comp, 'scoreboard', env, ctx),
      serve(comp, 'standings', env, ctx),
    ]);
    if (!sbRes.ok || !stRes.ok) return EMPTY_COMPETITION_VIEW;
    const [sbJson, stJson] = await Promise.all([sbRes.json(), stRes.json()]);
    return getAdapter(comp.key).transform(sbJson, stJson);
  } catch {
    return EMPTY_COMPETITION_VIEW;
  }
}

// Compose serveLeaders → Leader[] (the same cachedProducer + assembleLeaders
// pipeline the worker uses, but returning the parsed array directly).
// Used by the Astro scorers page for comps with leadersSource === 'pipeline'
// (NBA, eng.1). Empty array on any failure path.
export async function getPipelineLeaders(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<Leader[]> {
  try {
    const res = await serveLeaders(comp, env, ctx);
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    return Array.isArray(raw) ? (raw as Leader[]) : [];
  } catch {
    return [];
  }
}
