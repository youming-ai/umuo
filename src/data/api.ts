/// <reference types="@cloudflare/workers-types" />

import { getAdapter } from '../adapters';
import type { MatchDetail, StandingsData } from '../adapters/types';
import {
  buildUrl,
  COMPETITIONS,
  FOOTBALL_COMPETITIONS,
  type Competition,
  type Resource,
  seasonForDate,
  teamUrl,
} from '../competitions';
import {
  assembleLeaderboards,
  assembleLeaders,
  LEADERBOARDS_BY_SPORT,
  LEADERS_BY_SPORT,
  type Leaderboard,
} from '../leaders';
import { parseNewsFeed, prioritizeNewsForComp } from '../newsFeed';
import { parseTeamDetail, parseTeamInjuries } from '../teamDetail';
import { parseTeams } from '../teams';
import { parseLeagueInjuries, parseTransactions } from '../transactions';
import type {
  CompMatch,
  ExploreArticle,
  ExploreArticleType,
  ExploreFeed,
  ExploreFilterOption,
  ExploreFilterSet,
  LeagueInjuryGroup,
  NewsItem,
  TeamDetail,
  TeamInjury,
  TeamSummary,
  TopScorer,
  TransactionItem,
} from '../types';
import { marqueeMatches } from '../utils/marquee';

// Edge cache for the upstream data APIs. The SPA calls same-origin /api/*; the
// Worker fetches the third-party source and caches the body in KV. Now lifted
// out of `worker/index.ts` so Astro SSR pages can call these functions
// directly (env from 'cloudflare:workers' + Astro.locals.cfContext) and share
// the same KV cache + in-flight coalescing + serve-stale-on-outage semantics.
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

// Leaders pipeline fetch: TIMEOUT-ONLY (no retry). assembleLeaders /
// assembleLeaderboards fan out one primary doc + up to ~40 $ref subrequests
// for a multi-board stats page; retrying each would risk blowing the Workers
// 50-subrequest cap on a partial outage. So unlike the single-URL cached()
// path (which retries), every leaders fetch gets exactly one attempt with a
// 10s timeout — a hung $ref fails fast and degrades silently (resolveRefs
// leaves it unresolved), and a transient primary-doc failure throws so
// runCached serves stale. retries=0 = one attempt.
const leadersFetch = (url: string, init?: RequestInit): Promise<Response> =>
  fetchWithRetry(url, init ?? {}, 0, 10_000);

export type Env = Cloudflare.Env;

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
// is per-event.
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
  let stored: Entry | null = null;
  try {
    stored = await env.CACHE.get<Entry>(cacheKey, 'json');
  } catch (err) {
    // A KV read hiccup (transient isolate-level failure) must not 500 the
    // request — treat it as a miss and revalidate from upstream. The produce
    // path below still owns serve-stale-on-outage for upstream failures.
    console.error(`[data] KV get failed for ${cacheKey}:`, err);
  }
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

// ESPN's WAF allow-lists client agents by name and 403s everything else — a
// browser UA, no UA at all, and our own honest bot UA are all refused, while
// `curl/*` is served. This used to claim Chrome, which ESPN stopped serving,
// silently 403ing every scoreboard/standings/summary read. Keep in sync with
// API_JSON_HEADERS in src/feeds/ingest.ts, which hits the same host.
const ESPN_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'curl/8.7.1',
};

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
      const res = await fetchWithRetry(url, { headers: ESPN_HEADERS });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const text = await res.text();
      // A 2xx is not proof the body is usable: an edge/WAF page or a truncated
      // response still arrives as 200. Caching it would overwrite the last good
      // entry and defeat serve-stale, so parse before it can be stored —
      // throwing here routes to STALE/502 instead.
      // ponytail: parseability only. A 200 carrying a JSON error envelope is
      // still cached; getCompNews already screens for that downstream, and
      // rejecting any payload with an `error` key would risk discarding a good
      // body over an incidental field.
      try {
        JSON.parse(text);
      } catch {
        throw new Error('upstream returned unparseable JSON');
      }
      return text;
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
  resource: Resource,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { fresh, keep } = TTL[resource];
  // Season in the key: standings' URL carries a computed season, so a rollover
  // must not serve last season's body as fresh/stale from the same key. Applied
  // to every resource — one key namespace, no per-resource branch; the cost is
  // one miss wave per rollover.
  const season = comp.season ?? seasonForDate(comp.sport, new Date());
  return cached(
    `${comp.key}:${resource}:${season}`,
    buildUrl(comp, resource),
    fresh,
    keep,
    env,
    ctx,
  );
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
    season: comp.season ?? seasonForDate(comp.sport, new Date()),
    type: map.type,
    category: map.category,
    topN: 15,
  };
  return cachedProducer(
    `${comp.key}:leaders:${cfg.season}`,
    () => assembleLeaders(leadersFetch, cfg),
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
    `${comp.key}:leaderboards:${cfg.season}`,
    () => assembleLeaderboards(leadersFetch, cfg, specs),
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
    return prioritizeNewsForComp(parseNewsFeed(json), comp);
  } catch {
    return [];
  }
}

// Merge per-competition news lists into one feed: dedupe by id, newest first.
// Pure (no I/O) so it's unit-testable in isolation; getAggregatedNews fans out
// then calls this. Items without an id are kept (never deduped).
export function mergeNewsLists(lists: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>();
  const merged: NewsItem[] = [];
  for (const item of lists.flat()) {
    if (item.id) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
    }
    merged.push(item);
  }
  merged.sort((a, b) => b.published.localeCompare(a.published));
  return merged;
}

// Cross-competition news for the global home: fan out getCompNews over every
// registered competition, then merge (dedupe by id, newest first). Each comp
// fails soft (empty array on outage), so one comp's failure never sinks the feed.
export async function getAggregatedNews(env: Env, ctx: ExecutionContext): Promise<NewsItem[]> {
  const lists = await Promise.all(Object.values(COMPETITIONS).map((c) => getCompNews(c, env, ctx)));
  return mergeNewsLists(lists);
}
export interface HomeViewData {
  news: NewsItem[];
  scoreboardData: (CompMatch & { comp: string })[];
}

// Aggregated SSR view data for the global home: fans out getAggregatedNews +
// getCompetitionView over every competition so news and today's scoreboards are
// fully SSR-seeded on initial document render.
export async function getHomeView(env: Env, ctx: ExecutionContext): Promise<HomeViewData> {
  const comps = Object.values(COMPETITIONS);
  const [news, compViews] = await Promise.all([
    getAggregatedNews(env, ctx),
    Promise.all(comps.map((c) => getCompetitionView(c, env, ctx))),
  ]);
  // marqueeMatches runs HERE, not in useTicker's render path: it depends on "now"
  // and on the renderer's timezone, so the server and the browser would disagree
  // and the hydration render would not match the SSR markup. One selection,
  // computed once, used by both. The browser recomputes it after its first poll.
  const scoreboardData = marqueeMatches(
    compViews.flatMap((v, i) => v.matches.map((m) => ({ ...m, comp: comps[i].key }))),
    Date.now(),
  );
  return { news, scoreboardData };
}

// --- AI-curated football Explore feed (D1) ---

export interface ExploreQuery {
  comp?: string;
  source?: string;
  tag?: string;
  q?: string;
  /** Opaque page boundary from ExploreFeed.nextCursor — see parseExploreCursor. */
  cursor?: string;
  limit?: number;
}

const EMPTY_EXPLORE_FILTERS: ExploreFilterSet = {
  competitions: [],
  sources: [],
  tags: [],
};

interface ExploreRow {
  id: unknown;
  title: unknown;
  description: unknown;
  ai_summary: unknown;
  ai_blurb: unknown;
  canonical_url: unknown;
  image_url: unknown;
  source_id: unknown;
  source_name: unknown;
  source_url: unknown;
  published_at: unknown;
  comp: unknown;
  article_type: unknown;
  quality_score: unknown;
  freshness_score: unknown;
  tags?: unknown;
}

interface CountRow {
  value: unknown;
  label?: unknown;
  count: unknown;
}

function rowString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function rowNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0;
}

function exploreArticleType(value: unknown): ExploreArticleType {
  const allowed: ExploreArticleType[] = [
    'news',
    'analysis',
    'rumor',
    'interview',
    'match-report',
    'transfer',
    'injury',
    'video',
  ];
  const candidate = rowString(value) as ExploreArticleType;
  return allowed.includes(candidate) ? candidate : 'news';
}

function sourceDomain(value: unknown): string {
  try {
    return new URL(rowString(value)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function rowTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : [];
  } catch {
    return [];
  }
}

function exploreArticle(row: ExploreRow): ExploreArticle {
  return {
    id: rowString(row.id),
    title: rowString(row.title),
    description: rowString(row.description),
    summary: rowString(row.ai_summary),
    blurb: rowString(row.ai_blurb),
    url: rowString(row.canonical_url),
    imageUrl: rowString(row.image_url),
    sourceId: rowString(row.source_id),
    sourceName: rowString(row.source_name),
    // Where the story lives, not where we polled it: the feed URL would print
    // feeds.bbci.co.uk / site.api.espn.com instead of bbc.com / espn.com.
    sourceDomain: sourceDomain(row.canonical_url),
    publishedAt: rowNumber(row.published_at),
    competition: rowString(row.comp) || null,
    articleType: exploreArticleType(row.article_type),
    tags: rowTags(row.tags),
    qualityScore: rowNumber(row.quality_score),
    freshnessScore: rowNumber(row.freshness_score),
  };
}

/**
 * A page boundary, as the sort key of the last row already delivered:
 * `<published_at>:<id>`. Keyset, not an offset — the feed has rows inserted at
 * the top every ingest tick, and an offset would slide the whole window down
 * underneath the reader, so page 2 would repeat rows from page 1.
 */
export function parseExploreCursor(value: string | undefined): [number, string] | null {
  if (!value) return null;
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const publishedAt = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isFinite(publishedAt) || !id) return null;
  return [publishedAt, id];
}

function exploreCursorFor(row: ExploreRow): string {
  return `${rowNumber(row.published_at)}:${rowString(row.id)}`;
}

function canonicalCursor(value: string | undefined): string | undefined {
  const parsed = parseExploreCursor(value?.slice(0, 120));
  return parsed ? `${parsed[0]}:${parsed[1]}` : undefined;
}

function normalizedExploreQuery(
  query: ExploreQuery,
): Required<Pick<ExploreQuery, 'limit'>> & Omit<ExploreQuery, 'limit'> {
  const comp =
    query.comp && Object.hasOwn(FOOTBALL_COMPETITIONS, query.comp) ? query.comp : undefined;
  const limit = Number.isInteger(query.limit) ? Math.min(24, Math.max(1, query.limit ?? 12)) : 12;
  return {
    comp,
    source: query.source?.trim().slice(0, 80) || undefined,
    tag: query.tag?.trim().toLowerCase().slice(0, 80) || undefined,
    q: query.q?.trim().slice(0, 100) || undefined,
    // Re-serialised from the parsed form, so a malformed cursor collapses to
    // "first page" instead of becoming its own cache key. Only cursors that
    // name a real (published_at, id) boundary can reach KV.
    cursor: canonicalCursor(query.cursor),
    limit,
  };
}

async function queryExplore(query: ExploreQuery, env: Env): Promise<ExploreFeed> {
  if (!env.DB) throw new Error('D1 binding is required');
  const normalized = normalizedExploreQuery(query);
  const where = ["a.status = 'published'", 'a.is_football = 1', "a.sport = 'soccer'"];
  const bindings: unknown[] = [];

  if (normalized.comp) {
    where.push('a.comp = ?');
    bindings.push(normalized.comp);
  }
  if (normalized.source) {
    where.push('a.source_id = ?');
    bindings.push(normalized.source);
  }
  if (normalized.tag) {
    where.push(
      'EXISTS (SELECT 1 FROM article_tags filter_tags WHERE filter_tags.article_id = a.id AND filter_tags.tag = ?)',
    );
    bindings.push(normalized.tag);
  }
  if (normalized.q) {
    const search = `%${normalized.q}%`;
    where.push('(a.title LIKE ? OR a.ai_summary LIKE ? OR a.ai_blurb LIKE ?)');
    bindings.push(search, search, search);
  }
  // Strictly after the last row delivered, in the same (published_at, id) order
  // the query sorts by. An unparseable cursor falls through to the first page
  // rather than erroring — a stale bookmark should still render something.
  const cursor = parseExploreCursor(normalized.cursor);
  if (cursor) {
    where.push('(a.published_at < ? OR (a.published_at = ? AND a.id < ?))');
    bindings.push(cursor[0], cursor[0], cursor[1]);
  }

  const statement = env.DB.prepare(
    `SELECT
         a.id, a.title, a.description, a.ai_summary, a.ai_blurb, a.canonical_url,
         a.image_url, a.source_id, s.name AS source_name, s.url AS source_url,
         a.published_at, a.comp, a.article_type, a.quality_score, a.freshness_score,
         COALESCE((SELECT json_group_array(at.tag) FROM article_tags at WHERE at.article_id = a.id), '[]') AS tags
       FROM articles a
       JOIN sources s ON s.id = a.source_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.published_at DESC, a.id DESC
       LIMIT ?`,
  ).bind(...bindings, normalized.limit + 1);
  const result = await statement.all<ExploreRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > normalized.limit;
  const page = rows.slice(0, normalized.limit);
  return {
    items: page.map(exploreArticle),
    nextCursor: hasMore && page.length > 0 ? exploreCursorFor(page[page.length - 1]!) : null,
  };
}

export function exploreQueryFromUrl(url: URL): ExploreQuery {
  const limitValue = url.searchParams.get('limit');
  const limit = limitValue === null ? Number.NaN : Number(limitValue);
  return {
    comp: url.searchParams.get('comp') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
    tag: url.searchParams.get('tag') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  };
}

export async function serveExplore(
  query: ExploreQuery,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const normalized = normalizedExploreQuery(query);

  // Free-text search bypasses KV. The cache key embeds the whole query, so a
  // hundred characters of arbitrary text is a hundred characters of arbitrary
  // cache key: an unauthenticated caller could write KV entries without limit
  // just by varying `q`. Caching would buy nothing anyway — a distinct search
  // is a miss by definition, and repeats are rare enough not to pay for.
  if (normalized.q) {
    try {
      return json(JSON.stringify(await queryExplore(normalized, env)), 200, 'MISS');
    } catch (error) {
      console.error('[data] explore search failed:', error);
      return json('{"error":"upstream unavailable"}', 502, 'MISS');
    }
  }

  // Everything reaching KV is now drawn from a bounded set: comp is checked
  // against FOOTBALL_COMPETITIONS, cursor against real row boundaries, limit is
  // clamped. source and tag stay user-supplied — a caller who varies them still
  // writes distinct keys, bounded only by the 1h TTL. They are kept cached
  // because rail clicks are the queries most worth caching; revisit if the
  // write volume ever shows up on the bill.
  const key = `explore:${encodeURIComponent(JSON.stringify(normalized))}`;
  return runCached(
    key,
    async () => JSON.stringify(await queryExplore(normalized, env)),
    60,
    3600,
    env,
    ctx,
  );
}

export async function getExploreFeed(
  query: ExploreQuery,
  env: Env,
  ctx: ExecutionContext,
): Promise<ExploreFeed> {
  try {
    const response = await serveExplore(query, env, ctx);
    if (!response.ok) return { items: [], nextCursor: null };
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object') return { items: [], nextCursor: null };
    const feed = parsed as Partial<ExploreFeed>;
    return {
      items: Array.isArray(feed.items) ? (feed.items as ExploreArticle[]) : [],
      // string, not number: the cursor became a keyset key. While this still
      // checked for a number it coerced every SSR page to null, so the first
      // paint always claimed the feed was exhausted and pagination never began.
      nextCursor: typeof feed.nextCursor === 'string' ? feed.nextCursor : null,
    };
  } catch {
    return { items: [], nextCursor: null };
  }
}

async function queryExploreFilters(comp: string, env: Env): Promise<ExploreFilterSet> {
  if (!env.DB) throw new Error('D1 binding is required');
  // Source and topic counts are scoped to the page's competition — on /eng.1 a
  // row reading "BBC Sport Football 29" has to mean 29 Premier League stories,
  // not 29 across all football. The competition list itself stays global: it is
  // the nav, so every league must remain reachable from every page.
  const published = `a.status = 'published' AND a.is_football = 1 AND a.sport = 'soccer'`;
  const scope = comp ? ' AND a.comp = ?' : '';
  const scopeBinding = comp ? [comp] : [];
  const [competitions, sources, tags] = await Promise.all([
    env.DB.prepare(
      `SELECT a.comp AS value, COUNT(*) AS count
         FROM articles a
         WHERE ${published} AND a.comp IS NOT NULL
         GROUP BY a.comp ORDER BY count DESC`,
    ).all<CountRow>(),
    env.DB.prepare(
      `SELECT a.source_id AS value, s.name AS label, COUNT(*) AS count
         FROM articles a JOIN sources s ON s.id = a.source_id
         WHERE ${published}${scope}
         GROUP BY a.source_id ORDER BY count DESC`,
    )
      .bind(...scopeBinding)
      .all<CountRow>(),
    env.DB.prepare(
      `SELECT t.tag AS value, COUNT(*) AS count
         FROM article_tags t JOIN articles a ON a.id = t.article_id
         WHERE ${published}${scope}
         GROUP BY t.tag ORDER BY count DESC LIMIT 40`,
    )
      .bind(...scopeBinding)
      .all<CountRow>(),
  ]);

  const competitionOptions: ExploreFilterOption[] = (competitions.results ?? [])
    .map((row: CountRow) => {
      const value = rowString(row.value);
      const competition = FOOTBALL_COMPETITIONS[value];
      return competition ? { value, label: competition.label, count: rowNumber(row.count) } : null;
    })
    .filter((option: ExploreFilterOption | null): option is ExploreFilterOption => option !== null);
  const sourceOptions = (sources.results ?? []).map((row: CountRow) => ({
    value: rowString(row.value),
    label: rowString(row.label) || rowString(row.value),
    count: rowNumber(row.count),
  }));
  const tagOptions = (tags.results ?? []).map((row: CountRow) => {
    const value = rowString(row.value);
    return { value, label: value, count: rowNumber(row.count) };
  });
  return { competitions: competitionOptions, sources: sourceOptions, tags: tagOptions };
}

export async function serveExploreFilters(
  comp: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const scoped = Object.hasOwn(FOOTBALL_COMPETITIONS, comp) ? comp : '';
  return runCached(
    `explore:filters:${scoped}`,
    async () => JSON.stringify(await queryExploreFilters(scoped, env)),
    300,
    3600,
    env,
    ctx,
  );
}

export async function getExploreFilters(
  comp: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<ExploreFilterSet> {
  try {
    const response = await serveExploreFilters(comp, env, ctx);
    if (!response.ok) return EMPTY_EXPLORE_FILTERS;
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object') return EMPTY_EXPLORE_FILTERS;
    const filters = parsed as Partial<ExploreFilterSet>;
    return {
      competitions: Array.isArray(filters.competitions) ? filters.competitions : [],
      sources: Array.isArray(filters.sources) ? filters.sources : [],
      tags: Array.isArray(filters.tags) ? filters.tags : [],
    };
  } catch {
    return EMPTY_EXPLORE_FILTERS;
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
// not per render).
//
// null = the team endpoint answered but the team has no name (a real 404).
// THROWS when the team endpoint is unavailable, so the page can answer 503
// rather than 404 on a transient outage. Roster/schedule/injuries stay
// best-effort: each degrades to empty without sinking the page.
export async function getTeamDetail(
  comp: Competition,
  teamId: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<TeamDetail | null> {
  const [teamRes, rosterRes, schedRes, injRes] = await Promise.all([
    cached(`team:${comp.key}:${teamId}`, teamUrl(comp, teamId, ''), 86400, 86400, env, ctx),
    cached(`roster:${comp.key}:${teamId}`, teamUrl(comp, teamId, 'roster'), 86400, 86400, env, ctx),
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
  if (!teamRes.ok) throw new Error('team endpoint unavailable');
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
    // Independent upstreams, independent failure: a standings outage must not
    // discard valid live scores. The adapter already tolerates `{}` standings
    // (getCompMatchBySlug relies on that too). Only a scoreboard failure is fatal.
    if (!sbRes.ok) return emptyCompetitionView(comp);
    const [sbJson, stJson] = await Promise.all([sbRes.json(), stRes.ok ? stRes.json() : {}]);
    return getAdapter(comp.key).transform(sbJson, stJson);
  } catch {
    return emptyCompetitionView(comp);
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
// event ID for the summary call.
//
// null = the scoreboard loaded and has no such slug (a real 404). THROWS when
// the upstream is unavailable, so the page can answer 503 instead of telling
// users and crawlers that a valid match URL permanently does not exist.
export async function getCompMatchBySlug(
  comp: Competition,
  slug: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<CompMatch | null> {
  const res = await serve(comp, 'scoreboard', env, ctx);
  if (!res.ok) throw new Error('scoreboard unavailable');
  const sbJson: unknown = await res.json();
  const view = getAdapter(comp.key).transform(sbJson, {});
  return view.matches.find((m) => m.slug === slug) ?? null;
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
