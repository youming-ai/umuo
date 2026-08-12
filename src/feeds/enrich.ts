import type { Env } from '../data/api';
import { FOOTBALL_COMPETITIONS } from '../competitions';
import { enrichBatchWithLLM, enrichWithLLM } from './llm';
import type { ArticleEnrichment, RawArticle } from './types';

function canonicalCompetition(value: string, fallback: string | null): string | null {
  const candidate = value.trim().toLowerCase();
  if (Object.hasOwn(FOOTBALL_COMPETITIONS, candidate)) return candidate;
  const byLabel = Object.values(FOOTBALL_COMPETITIONS).find(
    (competition) => competition.label.toLowerCase() === candidate,
  );
  if (byLabel) return byLabel.key;
  return fallback && Object.hasOwn(FOOTBALL_COMPETITIONS, fallback) ? fallback : null;
}

function freshnessScore(publishedAt: number, now = Date.now()): number {
  const ageHours = Math.max(0, now - publishedAt) / (60 * 60 * 1000);
  return Math.max(0, Math.min(100, Math.round(100 - (ageHours / 72) * 100)));
}

/**
 * The model returns free-form tags, so "Premier League" and "premier-league" used
 * to land as two separate rows and show up as two separate facets in the rail.
 * One spelling per topic: lowercase, whitespace collapsed to a single hyphen.
 */
export function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

export type ArticleProcessStatus = 'stored' | 'filtered' | 'skipped';

export interface ArticleProcessResult {
  id: string;
  status: ArticleProcessStatus;
}

export async function storedArticleId(db: D1Database, article: RawArticle): Promise<string | null> {
  const result = await db
    .prepare('SELECT id FROM articles WHERE canonical_url = ? OR fingerprint = ? LIMIT 1')
    .bind(article.canonicalUrl, article.fingerprint)
    .first<{ id: string }>();
  return result?.id ?? null;
}

function score(article: RawArticle, enrichment: ArticleEnrichment): number {
  return Math.max(
    0,
    Math.min(100, Math.round(enrichment.qualityScore * 0.7 + article.sourceAuthority * 0.3)),
  );
}

export function modelFor(env: Env): string {
  return env.LLM_MODEL || 'glm-5.2';
}

/**
 * Enrich a whole batch in one LLM call, falling back to per-article calls if
 * the batch comes back unusable. A batch that returns the wrong number of
 * results cannot be mapped positionally, and guessing would attach one
 * article's summary to another, so the fallback is the only safe response.
 *
 * In the fallback, a single "poison" article (one the model consistently
 * refuses or returns unparseable JSON for) is isolated to a null slot rather
 * than allowed to throw — the caller retries only that message, so one bad
 * story can no longer drag the whole batch to the DLQ.
 */
export async function enrichBatch(
  env: Env,
  articles: RawArticle[],
): Promise<(ArticleEnrichment | null)[]> {
  const apiKey = env.LLM_API_KEY;
  const baseUrl = env.LLM_BASE_URL || 'https://api.z.ai/api/coding/paas/v4';
  const model = modelFor(env);
  if (articles.length === 1) {
    try {
      return [await enrichWithLLM(apiKey, baseUrl, model, articles[0]!)];
    } catch (error) {
      console.error('[enrich] single-article enrichment failed:', error);
      return [null];
    }
  }
  try {
    return await enrichBatchWithLLM(apiKey, baseUrl, model, articles);
  } catch (error) {
    console.error('[enrich] batch failed, falling back to per-article:', error);
    const results: (ArticleEnrichment | null)[] = [];
    for (const article of articles) {
      try {
        results.push(await enrichWithLLM(apiKey, baseUrl, model, article));
      } catch (articleError) {
        console.error(`[enrich] ${article.sourceId} failed in fallback:`, articleError);
        results.push(null);
      }
    }
    return results;
  }
}

/**
 * Persist one enriched article: the article row and its tags. The agent_runs
 * audit trail and source_health counters were dropped — neither was ever read
 * back, so the writes were pure overhead.
 */
export async function storeEnrichedArticle(
  env: Env,
  article: RawArticle,
  enrichment: ArticleEnrichment,
): Promise<ArticleProcessResult> {
  const now = Date.now();
  const competition = canonicalCompetition(enrichment.competition, article.comp);
  const isFootball = enrichment.isFootball;
  const status = isFootball ? 'published' : 'filtered';
  const articleId = article.fingerprint;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO articles (
           id, source_id, canonical_url, fingerprint, title, description, ai_summary, ai_blurb,
           image_url, published_at, fetched_at, sport, comp, article_type, is_football,
           quality_score, freshness_score, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'soccer', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
    ).bind(
      articleId,
      article.sourceId,
      article.canonicalUrl,
      article.fingerprint,
      article.title,
      article.description,
      enrichment.summary,
      enrichment.blurb,
      article.imageUrl,
      article.publishedAt,
      article.fetchedAt,
      competition,
      enrichment.articleType,
      isFootball ? 1 : 0,
      score(article, enrichment),
      freshnessScore(article.publishedAt, now),
      status,
      now,
      now,
    ),
    ...[...new Set(enrichment.tags.map(normalizeTag).filter(Boolean))].map((tag) =>
      env.DB.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag) VALUES (?, ?)').bind(
        articleId,
        tag,
      ),
    ),
  ]);

  return { id: articleId, status: isFootball ? 'stored' : 'filtered' };
}
