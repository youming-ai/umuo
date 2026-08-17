import { FOOTBALL_COMPETITIONS } from '../competitions';
import type { Env } from '../data/api';
import { enrichBatchWithLLM, enrichWithLLM } from './llm';
import { fillBody } from './readable';
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
  return env.LLM_MODEL || 'gpt-5.6-luna';
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
  const status = isFootball ? 'published' : 'filtered';
  const articleId = article.fingerprint;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO articles (
           id, source_id, canonical_url, fingerprint, title, description, ai_summary, ai_blurb,
           image_url, image_width, image_height, published_at, fetched_at, sport, comp, article_type, is_football,
           quality_score, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'soccer', ?, ?, ?, ?, ?, ?, ?)
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
      article.imageWidth,
      article.imageHeight,
      article.publishedAt,
      article.fetchedAt,
      competition,
      enrichment.articleType,
      isFootball ? 1 : 0,
      score(article, enrichment),
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

// --- Re-enrichment of existing rows ---

export interface ReEnrichReport {
  processed: number;
  failed: number;
  remaining: number;
}

interface ReEnrichRow {
  id: unknown;
  title: unknown;
  description: unknown;
  canonical_url: unknown;
  fingerprint: unknown;
  image_url: unknown;
  image_width: unknown;
  image_height: unknown;
  published_at: unknown;
  fetched_at: unknown;
  comp: unknown;
  source_id: unknown;
  source_name: unknown;
  authority_score: unknown;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;
}

function rowToRawArticle(row: ReEnrichRow): RawArticle {
  const canonicalUrl = str(row.canonical_url);
  return {
    sourceId: str(row.source_id),
    sourceName: str(row.source_name),
    sourceAuthority: num(row.authority_score),
    comp: str(row.comp) || null,
    title: str(row.title),
    description: str(row.description),
    body: '',
    url: canonicalUrl,
    canonicalUrl,
    imageUrl: str(row.image_url),
    imageWidth: num(row.image_width),
    imageHeight: num(row.image_height),
    publishedAt: num(row.published_at),
    fetchedAt: num(row.fetched_at),
    fingerprint: str(row.fingerprint),
  };
}

async function countRemaining(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND updated_at = created_at",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Re-score an existing article with the current prompt (editorial quality,
 *  controlled tags, body-aware summary). UPDATEs the row and replaces its
 *  tags. The article id IS the fingerprint. */
async function reEnrichArticle(
  env: Env,
  article: RawArticle,
  enrichment: ArticleEnrichment,
): Promise<void> {
  const now = Date.now();
  const competition = canonicalCompetition(enrichment.competition, article.comp);
  const isFootball = enrichment.isFootball;
  const status = isFootball ? 'published' : 'filtered';
  const tags = [...new Set(enrichment.tags.map(normalizeTag).filter(Boolean))];
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE articles SET
           ai_summary = ?, ai_blurb = ?, comp = ?, article_type = ?, is_football = ?,
           quality_score = ?, status = ?, updated_at = ?
         WHERE id = ?`,
    ).bind(
      enrichment.summary,
      enrichment.blurb,
      competition,
      enrichment.articleType,
      isFootball ? 1 : 0,
      score(article, enrichment),
      status,
      now,
      article.fingerprint,
    ),
    env.DB.prepare('DELETE FROM article_tags WHERE article_id = ?').bind(article.fingerprint),
    ...tags.map((tag) =>
      env.DB.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag) VALUES (?, ?)').bind(
        article.fingerprint,
        tag,
      ),
    ),
  ]);
}

/** Re-enrich one batch of published articles that have never been re-scored
 *  (updated_at = created_at, so no migration column needed). Processes the
 *  highest quality_score first so the stale confidence-flavoured rows the
 *  quality-primary sort surfaces get editorial scores and re-sort fastest.
 *  Self-terminates: re-enrich sets updated_at, so when no eligible rows remain
 *  the batch is empty. Null/failure results are marked done so a poison
 *  article can't loop forever — it keeps its old score (ponytail: rare,
 *  accept one stale row over an infinite backfill). */
export async function reEnrichBatch(env: Env, limit = 8): Promise<ReEnrichReport> {
  if (!env.DB) throw new Error('D1 binding is required');
  if (!env.LLM_API_KEY) throw new Error('LLM_API_KEY is not configured');

  const rows = await env.DB.prepare(
    `SELECT a.id, a.title, a.description, a.canonical_url, a.fingerprint,
              a.image_url, a.image_width, a.image_height, a.published_at, a.fetched_at,
              a.comp, a.source_id, s.name AS source_name, s.authority_score
         FROM articles a JOIN sources s ON s.id = a.source_id
        WHERE a.status = 'published' AND a.updated_at = a.created_at
        ORDER BY a.quality_score DESC, a.published_at DESC
        LIMIT ?`,
  )
    .bind(limit)
    .all<ReEnrichRow>();
  const batch = rows.results ?? [];
  if (batch.length === 0) return { processed: 0, failed: 0, remaining: 0 };

  const articles = batch.map(rowToRawArticle);
  await Promise.all(articles.map(fillBody));

  let enrichments: (ArticleEnrichment | null)[];
  try {
    enrichments = await enrichBatch(env, articles);
  } catch (error) {
    console.error('[re-enrich] enrichment failed for the whole batch:', error);
    await markDone(
      env,
      articles.map((a) => a.fingerprint),
    );
    return { processed: 0, failed: batch.length, remaining: await countRemaining(env) };
  }

  let processed = 0;
  const failedIds: string[] = [];
  for (const [index, article] of articles.entries()) {
    const enrichment = enrichments[index];
    if (!enrichment) {
      failedIds.push(article.fingerprint);
      continue;
    }
    try {
      await reEnrichArticle(env, article, enrichment);
      processed++;
    } catch (error) {
      console.error(`[re-enrich] ${article.sourceId} update failed:`, error);
      failedIds.push(article.fingerprint);
    }
  }
  // Mark failures done so they don't re-enter the queue every call.
  await markDone(env, failedIds);
  return { processed, failed: failedIds.length, remaining: await countRemaining(env) };
}

async function markDone(env: Env, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await env.DB.prepare(
    `UPDATE articles SET updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(Date.now(), ...ids)
    .run();
}
