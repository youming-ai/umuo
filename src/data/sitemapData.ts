import { CATEGORIES } from '../categories';
import { type Env, runCached } from './cache';
import { type CountRow, rowNumber, rowString } from './explore';

export interface SitemapNewsHub {
  category: string;
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

/** Category hubs + individual articles for the sitemap, derived from D1.
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
            `SELECT category AS value, MAX(published_at) AS count
               FROM articles
              WHERE status = 'published' AND is_on_topic = 1
                AND category IS NOT NULL
              GROUP BY category`,
          ),
          env.DB.prepare(
            `SELECT id, published_at
               FROM articles
              WHERE status = 'published' AND is_on_topic = 1
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
      .map((row) => ({ category: rowString(row.value), newest: rowNumber(row.count) }))
      .filter((row) => Object.hasOwn(CATEGORIES, row.category) && row.newest > 0)
      .map((row) => ({ category: row.category, lastmod: new Date(row.newest).toISOString() }));
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
            WHERE status = 'published' AND is_on_topic = 1
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
