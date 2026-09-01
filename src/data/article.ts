import { CATEGORIES } from '../categories';
import type { ExploreArticle } from '../types';
import { type Env, runCached } from './cache';
import { EXPLORE_ARTICLE_COLUMNS, type ExploreRow, exploreArticle } from './explore';

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
           WHERE a.id = ? AND a.status = 'published' AND a.is_on_topic = 1`,
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
 *  Matches articles sharing the category or tags, excluding current article.
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
        const conditions: string[] = ['a.id != ?', "a.status = 'published'", 'a.is_on_topic = 1'];
        const bindings: unknown[] = [article.id];

        const matchConditions: string[] = [];
        if (article.category && Object.hasOwn(CATEGORIES, article.category)) {
          matchConditions.push('a.category = ?');
          bindings.push(article.category);
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
