import { decodeEntities } from '../utils/coerce';
import type { RawArticle } from './types';

/** Crude HTML → plain text for feeding the enrichment model.
 *
 * No DOM in Workers, so this strips tags with regexes instead of a Readability
 * pass. It drops script/style/nav/footer/header/aside blocks first, then all
 * remaining tags, decodes a few entities, and collapses whitespace. The model
 * is robust to residual boilerplate, and the caller truncates.
 *
 * ponytail: regex stripping leaves ad/boilerplate noise and misses
 * JS-rendered bodies. Ceiling is summaries with stray nav text. Upgrade path:
 * linkedom + @mozilla/readability if summaries visibly degrade. */
export function extractText(html: string): string {
  return decodeEntities(
    html
      .replace(
        /<(script|style|nav|footer|header|aside|noscript|head|title|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,
        ' ',
      )
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

// Feeds that only syndicate a teaser leave the model blind to the actual
// story. Fetch the page body when the feed text is shorter than this so the
// blurb/tags/classification reflect the article, not a one-line hook.
const BODY_FETCH_MIN_LEN = 400;
const BODY_FETCH_SLICE = 3000;

// A browser-ish UA: many publisher CMSes 403 non-browser agents. Marking as
// compatible + the site URL is honest about who is fetching.
const ARTICLE_HEADERS = {
  accept: 'text/html, application/xhtml+xml, */*',
  'user-agent': 'Mozilla/5.0 (compatible; news-desk/1.0; +https://umuo.app)',
};

/** Best-effort fetch of the article page so the model sees the story body,
 *  not just the feed teaser. Failures (403, timeout, JS-only page) are
 *  swallowed — the article keeps whatever body the feed gave us and the
 *  LLM still gets `description`. */
export async function fillBody(article: RawArticle): Promise<void> {
  if ((article.body ?? '').length >= BODY_FETCH_MIN_LEN) return;
  try {
    const response = await fetch(article.canonicalUrl, {
      headers: ARTICLE_HEADERS,
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    });
    if (!response.ok) return;
    const text = extractText(await response.text());
    if (text.length > BODY_FETCH_MIN_LEN) {
      article.body = text.slice(0, BODY_FETCH_SLICE);
    }
  } catch {
    // Network/timeout/parse failure — degrade to feed text.
  }
}
