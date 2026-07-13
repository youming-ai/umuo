/// <reference types="@cloudflare/workers-types" />

import { getAdapter } from '../adapters';
import type { MatchDetail, StandingsData } from '../adapters/types';
import { type Competition, type Resource, buildUrl, seasonForDate, teamUrl } from '../competitions';
import {
  assembleLeaderboards,
  assembleLeaders,
  LEADERBOARDS_BY_SPORT,
  LEADERS_BY_SPORT,
  type Leaderboard,
} from '../leaders';
import { parseNewsFeed } from '../newsFeed';
import { parseTeams } from '../teams';
import { parseTeamDetail, parseTeamInjuries } from '../teamDetail';
import { parseLeagueInjuries, parseTransactions } from '../transactions';
import type {
  CompMatch,
  Leader,
  LeagueInjuryGroup,
  NewsItem,
  TeamDetail,
  TeamInjury,
  TeamSummary,
  TopScorer,
  TransactionItem,
} from '../types';

// Edge cache for the upstream data APIs. The SPA calls same-origin /api/*; the
// Worker fetches the third-party source and caches the body in KV. Now lifted
// out of `worker/index.ts` so Astro SSR pages can call these functions
// directly (Astro.locals.runtime.env.CACHE + ctx) and share the same KV cache
// + in-flight coalescing + serve-stale-on-outage semantics.
//
// `fresh` = seconds a cached copy is served without revalidating.
// `keep`  = how long KV retains it (≥ fresh) so a stale copy can cover an outage.
// KV TTL minimum is 60s.

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 1,
  timeoutMs = 10_000,
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      // Fresh timeout per attempt: a single AbortSignal.timeout shared across
      // retries is already aborted on the 2nd try, making the retry a no-op.
      // ponytail: ceiling is (retries+1)*timeoutMs + backoff of total wall-time.
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
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
  news: { fresh: 300, keep: 86400 },
  teams: { fresh: 86400, keep: 86400 },
  injuries: { fresh: 300, keep: 86400 },
  transactions: { fresh: 3600, keep: 86400 },
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
      const producedAt = Date.now();
      ctx.waitUntil(
        env.CACHE.put(cacheKey, JSON.stringify({ body, at: producedAt } satisfies Entry), {
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
  resource: 'scoreboard' | 'standings' | 'news',
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

// Multi-category Stats board (Scoring/Discipline/… leaderboards) from the same
// core.api leaders doc as serveLeaders, assembled into a grouped set. topN 5 ×
// ≤4 categories keeps the $ref fan-out under the Workers subrequest cap. Same
// serve-stale contract via cachedProducer.
export async function serveLeaderboards(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const map = LEADERS_BY_SPORT[comp.sport];
  const specs = LEADERBOARDS_BY_SPORT[comp.sport];
  if (!map || !specs) return json('{"error":"stats not supported for this sport"}', 400, 'MISS');
  const cfg = {
    sport: comp.sport,
    league: comp.league,
    season: comp.season ?? seasonForDate(comp.sport, new Date()),
    type: map.type,
    topN: 5,
  };
  return cachedProducer(
    `${comp.key}:leaderboards`,
    () => assembleLeaderboards(fetch, cfg, specs),
    3600,
    86400,
    env,
    ctx,
  );
}

// Per-competition news from ESPN's site.api league feed (site/v2/.../{league}/news).
// Unlike the removed "now" firehose (which ignored the leagues filter and always
// returned the global stream), this endpoint is genuinely league-scoped. Cached as
// the `news` resource; parsed to NewsItem[] for SSR seeding. Empty on any failure.
export async function getCompNews(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<NewsItem[]> {
  const res = await serve(comp, 'news', env, ctx);
  if (!res.ok) return [];
  try {
    const json: unknown = JSON.parse(await res.text());
    if (json && typeof json === 'object' && 'error' in json) return [];
    return parseNewsFeed(json);
  } catch {
    return [];
  }
}

// Per-competition team directory from ESPN's site.api teams list, parsed to
// TeamSummary[] (name-sorted). Empty array on any failure path.
export async function getTeams(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<TeamSummary[]> {
  const res = await serve(comp, 'teams', env, ctx);
  if (!res.ok) return [];
  try {
    return parseTeams(JSON.parse(await res.text()));
  } catch {
    return [];
  }
}

// Full team detail (header + roster + schedule + filtered injuries) from
// site.api. team/roster/schedule are cached per URL; injuries are cached per
// team via cachedProducer (the raw league feed is large — filter once per TTL,
// not per render). Returns null when the team endpoint fails or has no name.
export async function getTeamDetail(
  comp: Competition,
  teamId: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<TeamDetail | null> {
  try {
    const [teamRes, rosterRes, schedRes, injRes] = await Promise.all([
      cached(`team:${comp.key}:${teamId}`, teamUrl(comp, teamId, ''), 86400, 86400, env, ctx),
      cached(
        `roster:${comp.key}:${teamId}`,
        teamUrl(comp, teamId, 'roster'),
        86400,
        86400,
        env,
        ctx,
      ),
      cached(
        `schedule:${comp.key}:${teamId}`,
        teamUrl(comp, teamId, 'schedule'),
        3600,
        86400,
        env,
        ctx,
      ),
      cachedProducer(
        `injuries:${comp.key}:${teamId}`,
        async () => {
          const r = await serve(comp, 'injuries', env, ctx);
          return r.ok ? parseTeamInjuries(await r.json(), teamId) : [];
        },
        300,
        86400,
        env,
        ctx,
      ),
    ]);
    if (!teamRes.ok) return null;
    const [team, roster, sched] = await Promise.all([
      teamRes.json(),
      rosterRes.ok ? rosterRes.json() : {},
      schedRes.ok ? schedRes.json() : {},
    ]);
    const detail = parseTeamDetail(team, roster, sched, teamId);
    if (!detail.name) return null;
    const injRaw: unknown = injRes.ok ? await injRes.json() : [];
    detail.injuries = Array.isArray(injRaw) ? (injRaw as TeamInjury[]) : [];
    return detail;
  } catch {
    return null;
  }
}

// NBA roster moves: recent transactions from the league transactions feed.
// Empty where the sport doesn't populate it (soccer). Used by the Astro
// transactions page.
export async function getTransactions(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<TransactionItem[]> {
  const res = await serve(comp, 'transactions', env, ctx);
  if (!res.ok) return [];
  try {
    return parseTransactions(JSON.parse(await res.text()));
  } catch {
    return [];
  }
}

// Current league-wide injuries, grouped by team. Empty on failure / for sports
// that don't populate it.
export async function getLeagueInjuries(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<LeagueInjuryGroup[]> {
  const res = await serve(comp, 'injuries', env, ctx);
  if (!res.ok) return [];
  try {
    return parseLeagueInjuries(JSON.parse(await res.text()));
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

function emptyCompetitionView(comp: Competition): CompetitionView {
  return {
    matches: [],
    standings:
      comp.sport === 'basketball'
        ? { kind: 'basketball', conferences: [] }
        : { kind: 'soccer', groups: [] },
    scorers: [],
  };
}

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
    if (!sbRes.ok || !stRes.ok) return emptyCompetitionView(comp);
    const [sbJson, stJson] = await Promise.all([sbRes.json(), stRes.json()]);
    return getAdapter(comp.key).transform(sbJson, stJson);
  } catch {
    return emptyCompetitionView(comp);
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

// Compose serveLeaderboards → Leaderboard[] for the Astro stats page. Empty
// array on any failure path.
export async function getLeaderboards(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<Leaderboard[]> {
  try {
    const res = await serveLeaderboards(comp, env, ctx);
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    return Array.isArray(raw) ? (raw as Leaderboard[]) : [];
  } catch {
    return [];
  }
}

// Find a CompMatch by its URL slug, fetching only the scoreboard (not
// standings — the adapter handles empty standings gracefully). Used by
// the Astro match-detail page to validate the URL AND get the match's
// event ID for the summary call. Returns null if the slug isn't found
// or the upstream fails.
export async function getCompMatchBySlug(
  comp: Competition,
  slug: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<CompMatch | null> {
  try {
    const res = await serve(comp, 'scoreboard', env, ctx);
    if (!res.ok) return null;
    const sbJson: unknown = await res.json();
    const view = getAdapter(comp.key).transform(sbJson, {});
    return view.matches.find((m) => m.slug === slug) ?? null;
  } catch {
    return null;
  }
}

// Fetch + transform the ESPN summary into a MatchDetail. Wraps
// serveSummary + the sport adapter's transformSummary. Returns null on
// any failure path (non-ok, json error, adapter error).
export async function getMatchSummary(
  comp: Competition,
  eventId: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<MatchDetail | null> {
  try {
    const res = await serveSummary(comp, eventId, env, ctx);
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return getAdapter(comp.key).transformSummary(json);
  } catch {
    return null;
  }
}
