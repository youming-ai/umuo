import { CATEGORIES } from '../categories';
import { isVideoMediaUrl, proxiedImageUrl } from '../media';
import { GLOBAL_FEED_LABEL } from '../site';
import type {
  ExploreArticle,
  ExploreArticleType,
  ExploreFeed,
  ExploreFilterOption,
  ExploreFilterSet,
} from '../types';
import { num } from '../utils/coerce';
import { type Env, json, runCached } from './cache';
import { renderExploreRss } from './exploreRss';

// --- Curated Explore feed (D1) ---

export interface ExploreQuery {
  category?: string;
  source?: string;
  tag?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

const EMPTY_EXPLORE_FILTERS: ExploreFilterSet = {
  categories: [],
};

export interface ExploreRow {
  id: unknown;
  title: unknown;
  description: unknown;
  ai_summary: unknown;
  ai_blurb: unknown;
  canonical_url: unknown;
  image_url: unknown;
  image_width: unknown;
  image_height: unknown;
  published_at: unknown;
  day_bucket: unknown;
  category: unknown;
  article_type: unknown;
  quality_score: unknown;
  freshness_score: unknown;
  tags?: unknown;
}

export interface CountRow {
  value: unknown;
  label?: unknown;
  count: unknown;
}

export const rowString = (v: unknown): string => (typeof v === 'string' ? v : '');
export const rowNumber = num;

function exploreArticleType(value: unknown): ExploreArticleType {
  const allowed: ExploreArticleType[] = [
    'link',
    'news',
    'review',
    'deal',
    'leak',
    'analysis',
    'guide',
    'video',
  ];
  const candidate = rowString(value) as ExploreArticleType;
  // Unknown or NULL article_type falls back to 'link': every row this pipeline
  // writes is a curated link, so a legacy value must not surface as 'news'.
  return allowed.includes(candidate) ? candidate : 'link';
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

export function exploreArticle(row: ExploreRow): ExploreArticle {
  // The video judgement reads the URL as the feed delivered it — before the
  // /media rewrite, which can strip the extension the check depends on.
  const rawImageUrl = rowString(row.image_url);
  return {
    id: rowString(row.id),
    title: rowString(row.title),
    description: rowString(row.description),
    summary: rowString(row.ai_summary),
    blurb: rowString(row.ai_blurb),
    url: rowString(row.canonical_url),
    // Upstream-hosted images are rewritten to /media so the feed's own CDN
    // origin never reaches markup, the payload, or og:image.
    imageUrl: proxiedImageUrl(rawImageUrl),
    isVideo: isVideoMediaUrl(rawImageUrl),
    imageWidth: rowNumber(row.image_width),
    imageHeight: rowNumber(row.image_height),
    // Story domain, not feed URL — feeds.bbci.co.uk → bbc.com.
    sourceDomain: sourceDomain(row.canonical_url),
    publishedAt: rowNumber(row.published_at),
    category: rowString(row.category) || null,
    articleType: exploreArticleType(row.article_type),
    tags: rowTags(row.tags),
    qualityScore: rowNumber(row.quality_score),
    freshnessScore: rowNumber(row.freshness_score),
  };
}

/** Keyset cursor `<day>:<quality>:<published_at>:<id>`. The feed sorts by
 *  recency at day granularity first (newest day wins — an explore feed must not
 *  pin a 75-day-old link above today's), then editorial quality within the
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
export const EXPLORE_ARTICLE_COLUMNS =
  'a.id, a.title, a.description, a.ai_summary, a.ai_blurb, a.canonical_url, ' +
  'a.image_url, a.image_width, a.image_height, ' +
  'a.published_at, (a.published_at / 86400000) AS day_bucket, a.category, a.article_type, a.quality_score, ' +
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
  const category =
    query.category && Object.hasOwn(CATEGORIES, query.category) ? query.category : undefined;
  const limit = Number.isInteger(query.limit) ? Math.min(24, Math.max(1, query.limit ?? 10)) : 10;
  return {
    category,
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
  const where = ["a.status = 'published'", 'a.is_on_topic = 1'];
  const bindings: unknown[] = [];

  if (normalized.category) {
    where.push('a.category = ?');
    bindings.push(normalized.category);
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
    category: url.searchParams.get('category') ?? undefined,
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

  // What is left is bounded: category is checked against CATEGORIES and
  // limit is clamped. `source`/`tag` are no longer read from the request.
  //
  // The key is versioned because a warm KV entry is served verbatim, before any
  // mapper runs, so a payload-shape change would otherwise keep serving the old
  // shape — into the API and the island's hydration markup — until it
  // revalidated (and for the full `keep` window if D1 revalidation failed).
  // Bump this whenever the article payload changes:
  //   v2 dropped `sourceName`; v3 dropped `sourceId` and re-originated imageUrl;
  //   v4 added `isVideo`.
  const key = `explore:v4:${encodeURIComponent(JSON.stringify(normalized))}`;
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
 *  (subscribers take the head, not paginate); keeps category/source/tag for
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

  const scopeLabel = normalized.category
    ? (CATEGORIES[normalized.category]?.label ?? normalized.category)
    : GLOBAL_FEED_LABEL;
  // Per-category feeds link to /<category> so a reader clicking through lands
  // on the matching hub rather than the global home.
  const channelLink = normalized.category ? `${origin}/${normalized.category}` : `${origin}/`;

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

/** Category options for the rail, derived from D1. Cached so a crawler burst
 *  doesn't fan out to D1. */
async function queryExploreFilters(_category: string, env: Env): Promise<ExploreFilterSet> {
  if (!env.DB) throw new Error('D1 binding is required');
  // Category list is global — every hub stays reachable.
  const published = "a.status = 'published' AND a.is_on_topic = 1";
  const categories = await env.DB.prepare(
    `SELECT a.category AS value, COUNT(*) AS count
       FROM articles a
       WHERE ${published} AND a.category IS NOT NULL
       GROUP BY a.category ORDER BY count DESC`,
  ).all<CountRow>();

  const categoryOptions: ExploreFilterOption[] = (categories.results ?? [])
    .map((row: CountRow) => {
      const value = rowString(row.value);
      const match = CATEGORIES[value];
      return match ? { value, label: match.label, count: rowNumber(row.count) } : null;
    })
    .filter((option: ExploreFilterOption | null): option is ExploreFilterOption => option !== null);

  return { categories: categoryOptions };
}

export async function serveExploreFilters(
  category: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const scoped = Object.hasOwn(CATEGORIES, category) ? category : '';
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
  category: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<ExploreFilterSet> {
  try {
    const response = await serveExploreFilters(category, env, ctx);
    if (!response.ok) return EMPTY_EXPLORE_FILTERS;
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object') return EMPTY_EXPLORE_FILTERS;
    const filters = parsed as Partial<ExploreFilterSet>;
    return {
      categories: Array.isArray(filters.categories) ? filters.categories : [],
    };
  } catch {
    return EMPTY_EXPLORE_FILTERS;
  }
}
