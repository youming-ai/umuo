/// <reference types="@cloudflare/workers-types" />

import { FOOTBALL_COMPETITIONS } from '../competitions';
import type {
  ExploreArticle,
  ExploreArticleType,
  ExploreFeed,
  ExploreFilterOption,
  ExploreFilterSet,
} from '../types';
import { renderExploreRss } from './exploreRss';

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

// Coalesce concurrent identical requests: each caller builds its OWN Response
// from the shared {body, status, cache} payload, because `Response#body` is a
// one-shot stream.
const inflight = new Map<string, Promise<CachedResult>>();

// `fresh` = seconds a cached copy serves without revalidating.
// `keep`  = how long KV retains it (≥ fresh) so a stale copy covers an outage.
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
    // KV hiccup — treat as miss; the produce path below still owns serve-stale.
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
  image_width: unknown;
  image_height: unknown;
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
    imageWidth: rowNumber(row.image_width),
    imageHeight: rowNumber(row.image_height),
    sourceId: rowString(row.source_id),
    sourceName: rowString(row.source_name),
    // Story domain, not poll URL — feeds.bbci.co.uk → bbc.com.
    sourceDomain: sourceDomain(row.canonical_url),
    publishedAt: rowNumber(row.published_at),
    competition: rowString(row.comp) || null,
    articleType: exploreArticleType(row.article_type),
    tags: rowTags(row.tags),
    qualityScore: rowNumber(row.quality_score),
    freshnessScore: rowNumber(row.freshness_score),
  };
}

/** Keyset cursor `<quality_score>:<published_at>:<id>`. The feed sorts by
 *  editorial quality first (the AI's job), then recency, so the cursor must
 *  carry the same three keys the ORDER BY uses — a cursor keyed only on
 *  (published_at, id) would skip or repeat rows once quality leads the sort.
 *  Offset would slide under rows inserted at the top every ingest tick. */

// Live freshness, computed at query time from published_at rather than the
// frozen insert-time snapshot in the column (which read ~100 for every card).
// Same formula as enrich.freshnessScore; 259200 = 72h in seconds.
const LIVE_FRESHNESS =
  "MAX(0, MIN(100, ROUND(100.0 - (CAST(strftime('%s','now') AS REAL) - a.published_at / 1000.0) / 259200.0 * 100.0))) AS freshness_score";

export function parseExploreCursor(value: string | undefined): [number, number, string] | null {
  if (!value) return null;
  const first = value.indexOf(':');
  if (first <= 0) return null;
  const second = value.indexOf(':', first + 1);
  if (second <= first + 1) return null;
  const qualityScore = Number(value.slice(0, first));
  const publishedAt = Number(value.slice(first + 1, second));
  const id = value.slice(second + 1);
  if (!Number.isFinite(qualityScore) || !Number.isFinite(publishedAt) || !id) return null;
  return [qualityScore, publishedAt, id];
}

function exploreCursorFor(row: ExploreRow): string {
  return `${rowNumber(row.quality_score)}:${rowNumber(row.published_at)}:${rowString(row.id)}`;
}

function canonicalCursor(value: string | undefined): string | undefined {
  const parsed = parseExploreCursor(value?.slice(0, 140));
  return parsed ? `${parsed[0]}:${parsed[1]}:${parsed[2]}` : undefined;
}

function normalizedExploreQuery(
  query: ExploreQuery,
): Required<Pick<ExploreQuery, 'limit'>> & Omit<ExploreQuery, 'limit'> {
  const comp =
    query.comp && Object.hasOwn(FOOTBALL_COMPETITIONS, query.comp) ? query.comp : undefined;
  const limit = Number.isInteger(query.limit) ? Math.min(24, Math.max(1, query.limit ?? 10)) : 10;
  return {
    comp,
    source: query.source?.trim().slice(0, 80) || undefined,
    tag: query.tag?.trim().toLowerCase().slice(0, 80) || undefined,
    q: query.q?.trim().slice(0, 100) || undefined,
    // Re-serialised so a malformed cursor collapses to "first page" instead of
    // becoming its own KV key.
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
  // Strictly after the last row delivered, in the same (quality_score,
  // published_at, id) order the query sorts by.
  const cursor = parseExploreCursor(normalized.cursor);
  if (cursor) {
    const [cq, cp, ci] = cursor;
    where.push(
      '(a.quality_score < ? OR (a.quality_score = ? AND a.published_at < ?) OR (a.quality_score = ? AND a.published_at = ? AND a.id < ?))',
    );
    bindings.push(cq, cq, cp, cq, cp, ci);
  }

  const statement = env.DB.prepare(
    `SELECT
         a.id, a.title, a.description, a.ai_summary, a.ai_blurb, a.canonical_url,
         a.image_url, a.image_width, a.image_height, a.source_id, s.name AS source_name, s.url AS source_url,
         a.published_at, a.comp, a.article_type, a.quality_score, ${LIVE_FRESHNESS},
         COALESCE((SELECT json_group_array(at.tag) FROM article_tags at WHERE at.article_id = a.id), '[]') AS tags
       FROM articles a
       JOIN sources s ON s.id = a.source_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.quality_score DESC, a.published_at DESC, a.id DESC
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

  // Free-text search bypasses KV — `q` is user-controlled, so caching it lets
  // an unauthenticated caller write unlimited KV entries.
  if (normalized.q) {
    try {
      return json(JSON.stringify(await queryExplore(normalized, env)), 200, 'MISS');
    } catch (error) {
      console.error('[data] explore search failed:', error);
      return json('{"error":"upstream unavailable"}', 502, 'MISS');
    }
  }

  // Everything reaching KV is drawn from a bounded set: comp is checked against
  // FOOTBALL_COMPETITIONS, cursor against real row boundaries, limit is clamped.
  // source and tag stay user-supplied and bounded only by the 1h TTL.
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

/** Items a feed poll carries, equal to `normalizedExploreQuery`'s ceiling. */
const RSS_ITEM_LIMIT = 24;

/** RSS 2.0 surface for the Explore feed. Drops `q` (transient) and `cursor`
 *  (subscribers take the head, not paginate); keeps comp/source/tag for
 *  bookmarks. Honours the same SWR freshness/cache as the JSON endpoint. */
export async function serveExploreRss(
  query: ExploreQuery,
  selfUrl: string,
  origin: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // A feed is the head of the query, nothing transient. Drop search + cursor
  // before going to KV so the cache key only carries the bookmark-worthy facets.
  const normalized = normalizedExploreQuery({
    ...query,
    q: undefined,
    cursor: undefined,
    limit: RSS_ITEM_LIMIT,
  });

  const scopeLabel = normalized.comp
    ? (FOOTBALL_COMPETITIONS[normalized.comp]?.label ?? normalized.comp)
    : 'All football';
  // Per-comp feeds link to /<comp> so a reader clicking through lands on the
  // matching hub rather than the global home.
  const channelLink = normalized.comp ? `${origin}/${normalized.comp}` : `${origin}/`;

  const key = `explore:rss:${encodeURIComponent(JSON.stringify(normalized))}`;
  const cached = await runCached(
    key,
    async () => {
      const feed = await queryExplore(normalized, env);
      return renderExploreRss(feed, scopeLabel, {
        includeAtomSelfLink: selfUrl,
        channelLink,
      });
    },
    60,
    3600,
    env,
    ctx,
  );

  // Pass runCached's non-OK response through untouched: relabelling the JSON
  // error body as application/rss+xml would hand every reader a parse error.
  if (!cached.ok) return cached;

  // Wrap the SWR's JSON-shaped response into the RSS content type. The body is
  // still XML; runCached only inspects the string.
  const xCache = cached.headers.get('x-cache') ?? 'MISS';
  return new Response(cached.body, {
    status: cached.status,
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'x-cache': xCache,
      'cache-control': 'public, max-age=300',
    },
  });
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
      // String, not number: keyset cursor. While it checked for number it
      // coerced every SSR page to null, so pagination never began.
      nextCursor: typeof feed.nextCursor === 'string' ? feed.nextCursor : null,
    };
  } catch {
    return { items: [], nextCursor: null };
  }
}

/** One published article for the `/a/{id}` detail page. Cached so a crawler
 *  burst of detail-page hits doesn't fan out to D1. */
export async function getArticle(
  id: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<ExploreArticle | null> {
  try {
    const response = await runCached(
      `article:${id}`,
      async () => {
        if (!env.DB) throw new Error('D1 binding is required');
        const row = await env.DB.prepare(
          `SELECT
             a.id, a.title, a.description, a.ai_summary, a.ai_blurb, a.canonical_url,
             a.image_url, a.image_width, a.image_height, a.source_id, s.name AS source_name, s.url AS source_url,
             a.published_at, a.comp, a.article_type, a.quality_score, ${LIVE_FRESHNESS},
             COALESCE((SELECT json_group_array(at.tag) FROM article_tags at WHERE at.article_id = a.id), '[]') AS tags
           FROM articles a
           JOIN sources s ON s.id = a.source_id
           WHERE a.id = ? AND a.status = 'published' AND a.is_football = 1 AND a.sport = 'soccer'`,
        )
          .bind(id)
          .first<ExploreRow>();
        return JSON.stringify(row);
      },
      300,
      3600,
      env,
      ctx,
    );
    if (!response.ok) return null;
    const row = (await response.json()) as ExploreRow | null;
    return row ? exploreArticle(row) : null;
  } catch (error) {
    console.error('[data] article lookup failed:', error);
    return null;
  }
}

async function queryExploreFilters(comp: string, env: Env): Promise<ExploreFilterSet> {
  if (!env.DB) throw new Error('D1 binding is required');
  // Source + topic counts are scoped to the page's competition; the
  // competition list itself is global — every league must stay reachable.
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

export interface SitemapArticle {
  id: string;
  lastmod: string;
}

export interface SitemapData {
  hubs: SitemapNewsHub[];
  articles: SitemapArticle[];
}

/** Competition hubs + individual articles for the sitemap, derived from D1.
 *  Article URLs at `/a/{id}` give each AI summary its own crawlable page.
 *  Degrades to empty arrays — a sitemap missing entries is survivable; a 500
 *  on /sitemap.xml is not. */
export async function getSitemapNews(env: Env, ctx: ExecutionContext): Promise<SitemapData> {
  const empty: SitemapData = { hubs: [], articles: [] };
  try {
    const response = await runCached(
      'sitemap:news',
      async () => {
        if (!env.DB) throw new Error('D1 binding is required');
        const [hubs, articles] = await env.DB.batch([
          env.DB.prepare(
            `SELECT comp AS value, MAX(published_at) AS count
               FROM articles
              WHERE status = 'published' AND is_football = 1 AND sport = 'soccer'
                AND comp IS NOT NULL
              GROUP BY comp`,
          ),
          env.DB.prepare(
            `SELECT id, published_at
               FROM articles
              WHERE status = 'published' AND is_football = 1 AND sport = 'soccer'
              ORDER BY published_at DESC
              LIMIT 50000`,
          ),
        ]);
        return JSON.stringify({ hubs: hubs.results ?? [], articles: articles.results ?? [] });
      },
      3600,
      86400,
      env,
      ctx,
    );
    if (!response.ok) return empty;
    const raw = (await response.json()) as {
      hubs: CountRow[];
      articles: { id: unknown; published_at: unknown }[];
    };
    const hubs: SitemapNewsHub[] = raw.hubs
      .map((row) => ({ comp: rowString(row.value), newest: rowNumber(row.count) }))
      .filter((row) => Object.hasOwn(FOOTBALL_COMPETITIONS, row.comp) && row.newest > 0)
      .map((row) => ({ comp: row.comp, lastmod: new Date(row.newest).toISOString() }));
    const articles: SitemapArticle[] = raw.articles
      .map((row) => ({
        id: rowString(row.id),
        lastmod: new Date(rowNumber(row.published_at)).toISOString(),
      }))
      .filter((row) => row.id);
    return { hubs, articles };
  } catch (error) {
    console.error('[data] sitemap news lookup failed:', error);
    return empty;
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
