/// <reference types="@cloudflare/workers-types" />

import { FOOTBALL_COMPETITIONS } from '../competitions';
import type {
  ExploreArticle,
  ExploreArticleType,
  ExploreFeed,
  ExploreFilterOption,
  ExploreFilterSet,
} from '../types';

// KV SWR core + the AI-curated Explore feed. The ESPN scoreboard plane
// (serve* / adapters / leaders) was removed with the competition pages; this
// file now only serves the D1 news surface. `runCached` keeps the shared
// cache + in-flight coalescing + serve-stale-on-outage semantics; `json`
// turns its payload into a Response.
//
// `fresh` = seconds a cached copy is served without revalidating.
// `keep`  = how long KV retains it (≥ fresh) so a stale copy can cover an outage.
// KV TTL minimum is 60s.

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
// cache. Everything downstream funnels through this one copy of the KV +
// in-flight coalescing + serve-stale-on-outage logic.
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

export interface SitemapNewsHub {
  comp: string;
  /** Newest published article in that hub, as an ISO 8601 instant. */
  lastmod: string;
}

/**
 * The competition hubs that actually hold published articles, newest first
 * article date included. Derived from D1 rather than the competition registry:
 * a hub the desk has never written about is a thin page, and /nba has no news
 * hub at all — src/pages/[comp]/index.astro serves football only, so listing
 * it from COMPETITIONS advertised a 404.
 *
 * Degrades to an empty list. A sitemap missing its news hubs is survivable;
 * a 500 on /sitemap.xml is not.
 */
export async function getSitemapNews(env: Env, ctx: ExecutionContext): Promise<SitemapNewsHub[]> {
  try {
    const response = await runCached(
      'sitemap:news',
      async () => {
        if (!env.DB) throw new Error('D1 binding is required');
        const result = await env.DB.prepare(
          `SELECT comp AS value, MAX(published_at) AS count
             FROM articles
            WHERE status = 'published' AND is_football = 1 AND sport = 'soccer'
              AND comp IS NOT NULL
            GROUP BY comp`,
        ).all<CountRow>();
        return JSON.stringify(result.results ?? []);
      },
      3600,
      86400,
      env,
      ctx,
    );
    if (!response.ok) return [];
    const rows = (await response.json()) as CountRow[];
    return rows
      .map((row) => ({ comp: rowString(row.value), newest: rowNumber(row.count) }))
      .filter((row) => Object.hasOwn(FOOTBALL_COMPETITIONS, row.comp) && row.newest > 0)
      .map((row) => ({ comp: row.comp, lastmod: new Date(row.newest).toISOString() }));
  } catch (error) {
    console.error('[data] sitemap news lookup failed:', error);
    return [];
  }
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
