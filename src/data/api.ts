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
// produce may return null to signal "not found" — the miss is served 404 and
// never cached, so a caller keyed by user-controlled input (e.g. article ids)
// can't be turned into an unbounded KV write amplifier. The mirror side is
// that a fixed nonexistent id now hits D1 on every request (no negative
// cache) — the same trade serveExplore already makes for free-text search.
// Legacy entries cached as "null" before this change still serve HIT/STALE
// with 200 until they age out within `keep`; callers re-parse defensively.
async function runCached(
  cacheKey: string,
  produce: () => Promise<string | null>,
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
      if (body === null) return { body: '{"error":"not found"}', status: 404, cache: 'MISS' };
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
  day_bucket: unknown;
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

/** Keyset cursor `<day>:<quality>:<published_at>:<id>`. The feed sorts by
 *  recency at day granularity first (newest day wins — a news desk must not
 *  pin a 75-day-old story above today's), then editorial quality within the
 *  day, then exact time, then id. Every key is immutable (the day bucket is
 *  floor(published_at / 86400000), not a now-relative window), so the keyset
 *  stays stable under the daily ingest inserts. Offset would slide under rows
 *  inserted at the top every ingest tick. */

// Live freshness, computed at query time from published_at rather than the
// frozen insert-time snapshot the column used to hold. Single source of truth
// for the freshness formula; 259200 = 72h in seconds. The stored freshness_score
// column is no longer written (defaults to 0) and ignored for display.
const LIVE_FRESHNESS =
  "MAX(0, MIN(100, ROUND(100.0 - (CAST(strftime('%s','now') AS REAL) - a.published_at / 1000.0) / 259200.0 * 100.0))) AS freshness_score";

/** Single source of truth for the article SELECT projection across explore feed,
 *  detail page, and related stories. */
const EXPLORE_ARTICLE_COLUMNS =
  'a.id, a.title, a.description, a.ai_summary, a.ai_blurb, a.canonical_url, ' +
  'a.image_url, a.image_width, a.image_height, a.source_id, s.name AS source_name, s.url AS source_url, ' +
  'a.published_at, (a.published_at / 86400000) AS day_bucket, a.comp, a.article_type, a.quality_score, ' +
  `${LIVE_FRESHNESS}, ` +
  "COALESCE((SELECT json_group_array(at.tag) FROM article_tags at WHERE at.article_id = a.id), '[]') AS tags";
export function parseExploreCursor(
  value: string | undefined,
): [number, number, number, string] | null {
  if (!value) return null;
  const first = value.indexOf(':');
  if (first <= 0) return null;
  const second = value.indexOf(':', first + 1);
  if (second <= first + 1) return null;
  const third = value.indexOf(':', second + 1);
  if (third <= second + 1) return null;
  const day = Number(value.slice(0, first));
  const qualityScore = Number(value.slice(first + 1, second));
  const publishedAt = Number(value.slice(second + 1, third));
  const id = value.slice(third + 1);
  if (
    !Number.isFinite(day) ||
    !Number.isFinite(qualityScore) ||
    !Number.isFinite(publishedAt) ||
    !id
  )
    return null;
  return [day, qualityScore, publishedAt, id];
}

function exploreCursorFor(row: ExploreRow): string {
  return `${rowNumber(row.day_bucket)}:${rowNumber(row.quality_score)}:${rowNumber(row.published_at)}:${rowString(row.id)}`;
}

function canonicalCursor(value: string | undefined): string | undefined {
  const parsed = parseExploreCursor(value?.slice(0, 160));
  return parsed ? `${parsed[0]}:${parsed[1]}:${parsed[2]}:${parsed[3]}` : undefined;
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
  // Strictly after the last row delivered, in the same (day, quality,
  // published_at, id) order the query sorts by. Day bucket is immutable
  // (floor(published_at / 86400000)), so the keyset stays stable.
  const cursor = parseExploreCursor(normalized.cursor);
  if (cursor) {
    const [cd, cq, cp, ci] = cursor;
    where.push(
      '(a.published_at / 86400000 < ?' +
        ' OR (a.published_at / 86400000 = ? AND a.quality_score < ?)' +
        ' OR (a.published_at / 86400000 = ? AND a.quality_score = ? AND a.published_at < ?)' +
        ' OR (a.published_at / 86400000 = ? AND a.quality_score = ? AND a.published_at = ? AND a.id < ?))',
    );
    bindings.push(cd, cd, cq, cd, cq, cp, cd, cq, cp, ci);
  }

  const statement = env.DB.prepare(
    `SELECT ${EXPLORE_ARTICLE_COLUMNS}
       FROM articles a
       JOIN sources s ON s.id = a.source_id
       WHERE ${where.join(' AND ')}
       ORDER BY day_bucket DESC, a.quality_score DESC, a.published_at DESC, a.id DESC
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
    // `source` and `tag` are deliberately not read: the rail dropped them, and
    // as free-form request input they only served to widen the KV key space.
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

  // Free-text search and deep pages bypass KV — both `q` and `cursor` are
  // user-controlled, so caching them lets an unauthenticated caller write
  // unlimited KV entries. Re-serialising the cursor is not enough: the id is
  // taken verbatim and the three numbers only have to be finite, so the key
  // space is unbounded either way. Page one — nearly all the traffic — still
  // caches, and later pages of an infinite scroll rarely hit a warm entry.
  if (normalized.q || normalized.cursor) {
    try {
      return json(JSON.stringify(await queryExplore(normalized, env)), 200, 'MISS');
    } catch (error) {
      console.error('[data] explore search failed:', error);
      return json('{"error":"upstream unavailable"}', 502, 'MISS');
    }
  }

  // What is left is bounded: comp is checked against FOOTBALL_COMPETITIONS and
  // limit is clamped. `source`/`tag` are no longer read from the request.
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
      // Deliberately longer than the KV fresh window (60s): feed readers poll
      // every 30–60 minutes, so a 5-minute edge cache saves origin hits
      // without any reader-visible staleness.
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
          `SELECT ${EXPLORE_ARTICLE_COLUMNS}
           FROM articles a
           JOIN sources s ON s.id = a.source_id
           WHERE a.id = ? AND a.status = 'published' AND a.is_football = 1 AND a.sport = 'soccer'`,
        )
          .bind(id)
          .first<ExploreRow>();
        return row ? JSON.stringify(row) : null;
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

/** Fetch related published articles for the `/a/{id}` detail page.
 *  Matches articles sharing the competition or tags, excluding current article.
 *  Cached in KV for 5 minutes. */
export async function getRelatedArticles(
  article: ExploreArticle,
  env: Env,
  ctx: ExecutionContext,
  limit = 4,
): Promise<ExploreArticle[]> {
  try {
    const clampedLimit = Math.min(12, Math.max(1, limit));
    const response = await runCached(
      `related:${article.id}:${clampedLimit}`,
      async () => {
        if (!env.DB) throw new Error('D1 binding is required');
        const conditions: string[] = [
          'a.id != ?',
          "a.status = 'published'",
          'a.is_football = 1',
          "a.sport = 'soccer'",
        ];
        const bindings: unknown[] = [article.id];

        const matchConditions: string[] = [];
        if (article.competition && Object.hasOwn(FOOTBALL_COMPETITIONS, article.competition)) {
          matchConditions.push('a.comp = ?');
          bindings.push(article.competition);
        }
        const relevantTags = article.tags.filter(Boolean).slice(0, 5);
        if (relevantTags.length > 0) {
          const placeholders = relevantTags.map(() => '?').join(', ');
          matchConditions.push(
            `EXISTS (SELECT 1 FROM article_tags filter_tags WHERE filter_tags.article_id = a.id AND filter_tags.tag IN (${placeholders}))`,
          );
          bindings.push(...relevantTags);
        }

        if (matchConditions.length > 0) {
          conditions.push(`(${matchConditions.join(' OR ')})`);
        }

        bindings.push(clampedLimit);

        const rows = await env.DB.prepare(
          `SELECT ${EXPLORE_ARTICLE_COLUMNS}
           FROM articles a
           JOIN sources s ON s.id = a.source_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY a.published_at DESC
           LIMIT ?`,
        )
          .bind(...bindings)
          .all<ExploreRow>();

        return JSON.stringify(rows.results ?? []);
      },
      300,
      3600,
      env,
      ctx,
    );
    if (!response.ok) return [];
    const rows = (await response.json()) as ExploreRow[];
    if (!Array.isArray(rows)) return [];
    return rows.map(exploreArticle);
  } catch (error) {
    console.error('[data] related articles lookup failed:', error);
    return [];
  }
}

async function queryExploreFilters(_comp: string, env: Env): Promise<ExploreFilterSet> {
  if (!env.DB) throw new Error('D1 binding is required');
  // Competition list is global — every league stays reachable.
  const published = "a.status = 'published' AND a.is_football = 1 AND a.sport = 'soccer'";
  const competitions = await env.DB.prepare(
    `SELECT a.comp AS value, COUNT(*) AS count
       FROM articles a
       WHERE ${published} AND a.comp IS NOT NULL
       GROUP BY a.comp ORDER BY count DESC`,
  ).all<CountRow>();

  const competitionOptions: ExploreFilterOption[] = (competitions.results ?? [])
    .map((row: CountRow) => {
      const value = rowString(row.value);
      const competition = FOOTBALL_COMPETITIONS[value];
      return competition ? { value, label: competition.label, count: rowNumber(row.count) } : null;
    })
    .filter((option: ExploreFilterOption | null): option is ExploreFilterOption => option !== null);

  return { competitions: competitionOptions };
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

export interface GoogleNewsArticleData {
  id: string;
  title: string;
  publishedAt: string;
}

/** Published articles from the last 48 hours for Google News sitemap (/sitemap-news.xml).
 *  Cached in KV for 30 minutes (fresh 1800s, keep 7200s). */
export async function getGoogleNewsSitemapArticles(
  env: Env,
  ctx: ExecutionContext,
  now = Date.now(),
): Promise<GoogleNewsArticleData[]> {
  try {
    const response = await runCached(
      'sitemap:google-news',
      async () => {
        if (!env.DB) throw new Error('D1 binding is required');
        const cutoff = now - 172_800_000; // 48h in ms
        const rows = await env.DB.prepare(
          `SELECT id, title, published_at
             FROM articles
            WHERE status = 'published' AND is_football = 1 AND sport = 'soccer'
              AND published_at >= ?
            ORDER BY published_at DESC
            LIMIT 1000`,
        )
          .bind(cutoff)
          .all<{ id: unknown; title: unknown; published_at: unknown }>();
        return JSON.stringify(rows.results ?? []);
      },
      1800,
      7200,
      env,
      ctx,
    );
    if (!response.ok) return [];
    const raw = (await response.json()) as { id: unknown; title: unknown; published_at: unknown }[];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) => ({
        id: rowString(row.id),
        title: rowString(row.title),
        publishedAt: new Date(rowNumber(row.published_at)).toISOString(),
      }))
      .filter((article) => article.id && article.title);
  } catch (error) {
    console.error('[data] google news sitemap lookup failed:', error);
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
    };
  } catch {
    return EMPTY_EXPLORE_FILTERS;
  }
}
