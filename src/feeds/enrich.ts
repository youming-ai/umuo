import { FOOTBALL_COMPETITIONS } from '../competitions';
import type { Env } from '../data/api';
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

/** One spelling per topic: lowercase, whitespace collapsed to a single hyphen. */
export function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/** Cross-source dedup key: lowercase with every non-alphanumeric stripped, so
 *  "Haaland double!" and "Haaland double" from different outlets collide.
 *  A headline with no Latin letters at all (CJK, Cyrillic, …) must not
 *  collapse to '' — the first one stored would make knownTitles treat every
 *  later non-English story as already ingested. Fall back to the lowercased
 *  original, which still collides only with an identical headline. */
export function normalizeTitle(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized || value.toLowerCase();
}

/** Blended editorial score below which an article is stored as `filtered`
 *  (hidden from the board) even when it is football. */
export const MIN_QUALITY_SCORE = 60;

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
  return env.LLM_MODEL || 'deepseek-v4-flash';
}

/** Enrich a whole batch in one LLM call, falling back to per-article calls if
 *  the batch comes back unusable. A batch that returns the wrong number of
 *  results cannot be mapped positionally, so the fallback is the only safe
 *  response. In the fallback, a single poison article is isolated to a null
 *  slot rather than allowed to throw — the caller retries only that message. */
export async function enrichBatch(
  env: Env,
  articles: RawArticle[],
): Promise<(ArticleEnrichment | null)[]> {
  const apiKey = env.LLM_API_KEY;
  const baseUrl = env.LLM_BASE_URL || 'https://api.b.ai/v1';
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

/** Persist one enriched article: the article row and its tags. */
export async function storeEnrichedArticle(
  env: Env,
  article: RawArticle,
  enrichment: ArticleEnrichment,
): Promise<ArticleProcessResult> {
  const now = Date.now();
  const competition = canonicalCompetition(enrichment.competition, article.comp);
  const isFootball = enrichment.isFootball;
  const qualityScore = score(article, enrichment);
  const status = isFootball && qualityScore >= MIN_QUALITY_SCORE ? 'published' : 'filtered';
  const articleId = article.fingerprint;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO articles (
           id, source_id, canonical_url, fingerprint, title, title_norm, description, ai_summary, ai_blurb,
           image_url, image_width, image_height, published_at, fetched_at, sport, comp, article_type, is_football,
           quality_score, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'soccer', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
    ).bind(
      articleId,
      article.sourceId,
      article.canonicalUrl,
      article.fingerprint,
      article.title,
      normalizeTitle(article.title),
      article.description,
      enrichment.summary,
      enrichment.blurb,
      article.imageUrl,
      article.imageWidth,
      article.imageHeight,
      article.publishedAt,
      article.fetchedAt,
      competition,
      enrichment.articleType,
      isFootball ? 1 : 0,
      qualityScore,
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

  return {
    id: articleId,
    status: isFootball && qualityScore >= MIN_QUALITY_SCORE ? 'stored' : 'filtered',
  };
}
