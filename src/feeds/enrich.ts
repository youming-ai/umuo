import type { Env } from '../data/api';
import { FOOTBALL_COMPETITIONS } from '../competitions';
import { enrichWithGemini } from './gemini';
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

async function storedArticleId(db: D1Database, article: RawArticle): Promise<string | null> {
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

export async function processArticle(env: Env, article: RawArticle): Promise<ArticleProcessResult> {
  if (!env.DB) throw new Error('D1 binding is required');

  // Checked before the agent_runs row is written: a duplicate is not an AI run,
  // and logging one row per skip grew the table by tens of thousands of rows a
  // day for nothing. ingestAllSources pre-filters too, but this stays the
  // authoritative check — it also covers canonical_url, not just fingerprint.
  const alreadyStored = await storedArticleId(env.DB, article);
  if (alreadyStored) return { id: alreadyStored, status: 'skipped' };

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';

  await env.DB.prepare(
    `INSERT INTO agent_runs (
       id, article_fingerprint, source_id, status, model, started_at
     ) VALUES (?, ?, ?, 'processing', ?, ?)`,
  )
    .bind(runId, article.fingerprint, article.sourceId, model, startedAt)
    .run();

  const finishRun = async (
    status: 'stored' | 'filtered' | 'skipped' | 'failed',
    articleId: string | null,
    error = '',
  ): Promise<void> => {
    await env.DB.prepare(
      `UPDATE agent_runs
          SET status = ?, article_id = ?, error = ?, finished_at = ?
        WHERE id = ?`,
    )
      .bind(status, articleId, error, Date.now(), runId)
      .run();
  };

  try {
    const enrichment = await enrichWithGemini(env.GEMINI_API_KEY, model, article);
    const now = Date.now();
    const competition = canonicalCompetition(enrichment.competition, article.comp);
    const isFootball = enrichment.isFootball;
    const status = isFootball ? 'published' : 'filtered';
    const articleId = article.fingerprint;

    const statements = [
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
    ];
    await env.DB.batch(statements);
    await finishRun(isFootball ? 'stored' : 'filtered', articleId);
    return { id: articleId, status: isFootball ? 'stored' : 'filtered' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown article processing error';
    await finishRun('failed', null, message);
    throw error;
  }
}
