import { CATEGORIES } from '../categories';
import type { Env } from '../data/api';
import type { RawArticle } from './types';

/** Quality score when the source declares no authority rating. */
const DEFAULT_QUALITY_SCORE = 50;

export function canonicalCategory(value: string | null): string | null {
  if (!value) return null;
  const candidate = value.trim().toLowerCase();
  if (Object.hasOwn(CATEGORIES, candidate)) return candidate;
  const byLabel = Object.values(CATEGORIES).find(
    (category) => category.label.toLowerCase() === candidate,
  );
  if (byLabel) return byLabel.key;
  return null;
}

/** Cross-source dedup key: lowercase Unicode letters/numbers, no punctuation. */
export function normalizeTitle(value: string): string {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
  return normalized || value.toLowerCase();
}

/** Persist one article directly: the article row.
 *
 *  Deliberately writes no `article_tags` row. The Poche feed carries no topic
 *  tags, and mirroring `category` into that table made the card render
 *  "Development · development" and the RSS emit both `category:development`
 *  and `tag:development`. The category already lives in `articles.category`,
 *  and nothing joins that table to read a category back. */
export async function storeArticle(env: Env, article: RawArticle): Promise<void> {
  const now = Date.now();
  const category = canonicalCategory(article.category);
  const articleId = article.fingerprint;
  // ponytail: summary and blurb duplicate description to populate legacy D1 columns (ai_summary/ai_blurb)
  const summary = article.description || article.title;
  const blurb = summary;
  // Single curated source today, so the score is the source's authority
  // rating; cards render it as the "Curated signal" meter. Falls back to a
  // neutral midpoint when no authority is declared.
  const qualityScore = article.sourceAuthority || DEFAULT_QUALITY_SCORE;

  await env.DB.prepare(
    `INSERT INTO articles (
           id, source_id, canonical_url, fingerprint, title, title_norm, description, ai_summary, ai_blurb,
           image_url, image_width, image_height, published_at, fetched_at, category, article_type, is_on_topic,
           quality_score, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
  )
    .bind(
      articleId,
      article.sourceId,
      article.canonicalUrl,
      article.fingerprint,
      article.title,
      normalizeTitle(article.title),
      article.description,
      summary,
      blurb,
      article.imageUrl,
      article.imageWidth,
      article.imageHeight,
      article.publishedAt,
      article.fetchedAt,
      category,
      'link',
      1,
      qualityScore,
      'published',
      now,
      now,
    )
    .run();
}
