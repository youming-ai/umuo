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
 *  Article URLs at `/a/{id}` give each stored summary its own crawlable page.
 *  Degrades to empty arrays — a sitemap missing entries is survivable; a 500
 *  on /sitemap.xml is not. */
export async function getSitemapNews(env: Env, ctx: ExecutionContext): Promise<SitemapData> {
  const empty: SitemapData = { hubs: [], articles: [] };
  try {
    const response = await runCached(
      'sitemap:news:v2',
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
