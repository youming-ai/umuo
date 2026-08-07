import type { Env } from '../data/api';
import { FOOTBALL_COMPETITIONS } from '../competitions';
import { enrichBatchWithGemini, enrichWithGemini } from './gemini';
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
 * Gemini returns free-form tags, so "Premier League" and "premier-league" used
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
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
  return env.GEMINI_MODEL || 'gemini-3.6-flash';
}

/**
 * Enrich a whole queue batch in one Gemini call, falling back to per-article
 * calls if the batch comes back unusable. A batch that returns the wrong number
 * of results cannot be mapped positionally, and guessing would attach one
 * article's summary to another, so the fallback is the only safe response.
 */
export async function enrichBatch(env: Env, articles: RawArticle[]): Promise<ArticleEnrichment[]> {
  const model = modelFor(env);
  if (articles.length === 1) {
    return [await enrichWithGemini(env.GEMINI_API_KEY, model, articles[0]!)];
  }
  try {
    return await enrichBatchWithGemini(env.GEMINI_API_KEY, model, articles);
  } catch (error) {
    console.error('[enrich] batch failed, falling back to per-article:', error);
    const results: ArticleEnrichment[] = [];
    for (const article of articles) {
      results.push(await enrichWithGemini(env.GEMINI_API_KEY, model, article));
    }
    return results;
  }
}

/**
 * Persist one enriched article: the article row, its tags, source health, and
 * an agent_runs record. The run row is written once with its final status —
 * the enrichment has already happened by the time we get here, so the old
 * insert-'processing'-then-update pair was two writes to record one fact.
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
           quality_score, freshness_score, status, raw_metadata, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'soccer', ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      safeJson({ source: article.sourceName, sourceAuthority: article.sourceAuthority }),
      now,
      now,
    ),
    ...[...new Set(enrichment.tags.map(normalizeTag).filter(Boolean))].map((tag) =>
      env.DB.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag) VALUES (?, ?)').bind(
        articleId,
        tag,
      ),
    ),
    env.DB.prepare('INSERT OR IGNORE INTO source_health (source_id) VALUES (?)').bind(
      article.sourceId,
    ),
    env.DB.prepare(
      `UPDATE source_health
         SET articles_inserted_count = articles_inserted_count + ?
       WHERE source_id = ?`,
    ).bind(isFootball ? 1 : 0, article.sourceId),
    env.DB.prepare(
      `INSERT INTO agent_runs (
         id, article_fingerprint, source_id, status, model, article_id, started_at, finished_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      article.fingerprint,
      article.sourceId,
      isFootball ? 'stored' : 'filtered',
      modelFor(env),
      articleId,
      now,
      Date.now(),
    ),
  ]);

  return { id: articleId, status: isFootball ? 'stored' : 'filtered' };
}

export async function recordFailedRun(
  env: Env,
  article: RawArticle,
  message: string,
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO agent_runs (
       id, article_fingerprint, source_id, status, model, error, started_at, finished_at
     ) VALUES (?, ?, ?, 'failed', ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      article.fingerprint,
      article.sourceId,
      modelFor(env),
      message.slice(0, 500),
      now,
      now,
    )
    .run();
}
