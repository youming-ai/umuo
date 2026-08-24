import type { Env } from '../data/api';
import { parseNewsFeed } from '../newsFeed';
import { enrichBatch, normalizeTitle, storeEnrichedArticle } from './enrich';
import { fillBody } from './readable';
import { parseRss } from './rss';
import { FEED_SOURCES } from './sources';
import { sleep } from '../utils/coerce';
import type { FeedSource, RawArticle } from './types';

// Lookups go out in chunks — a tick fetches ~700 articles today, and that grows
// with every source added.
const FINGERPRINT_LOOKUP_CHUNK = 90;

// Keep each B.AI request below the request timeout in llm.ts. Every chunk repeats the
// classifier instructions, so this trades a little input-token overhead for
// reliable completion on a cold backlog.
const ENRICHMENT_BATCH_SIZE = 8;

const RSS_HEADERS = {
  accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, */*',
  'user-agent': 'umuo-football-news/1.0 (+https://umuo.app)',
};

// ESPN's WAF allow-lists client agents by name (curl/*, python-requests/*,
// Go-http-client/*) and 403s everything else. Keep this in sync with any
// other ESPN call site.
const API_JSON_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'curl/8.7.1',
};

export function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    // `new URL('javascript:alert(1)')` parses fine. The result is rendered as
    // an href on the card and the detail-page CTA, so anything but http(s) is
    // dropped here — the caller already skips articles with an empty url.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith('utm_') ||
        ['fbclid', 'gclid', 'ref', 'referrer'].includes(normalizedKey)
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

export async function fingerprintFor(
  title: string,
  description: string,
  url: string,
): Promise<string> {
  const parsed = new URL(url);
  const input = `${title.trim().toLowerCase()}\n${description.trim().slice(0, 240).toLowerCase()}\n${parsed.hostname}${parsed.pathname}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      if (attempt === 2) return r;
    } catch (e) {
      if (attempt === 2) throw e;
    }
    await sleep(500 * (attempt + 1));
  }
  throw new Error('feed fetch failed');
}

async function readSource(
  source: FeedSource,
  fetchedAt: number,
): Promise<Omit<RawArticle, 'canonicalUrl' | 'fingerprint'>[]> {
  const response = await fetchWithRetry(
    source.url,
    source.kind === 'rss' ? RSS_HEADERS : API_JSON_HEADERS,
  );
  if (!response.ok) throw new Error(`${source.name} returned ${response.status}`);

  if (source.kind === 'rss') {
    return parseRss(await response.text(), source, fetchedAt);
  }

  const parsed = parseNewsFeed(await response.json());
  return parsed
    .map(
      (item): Omit<RawArticle, 'canonicalUrl' | 'fingerprint'> => ({
        sourceId: source.id,
        sourceName: source.name,
        sourceAuthority: source.authorityScore,
        comp: source.comp ?? null,
        title: item.headline,
        description: item.description,
        body: '',
        url: item.link,
        imageUrl: item.imageUrl,
        imageWidth: item.imageWidth,
        imageHeight: item.imageHeight,
        publishedAt: Date.parse(item.published) || fetchedAt,
        fetchedAt,
      }),
    )
    .filter((article) => article.title.length > 0 && article.url.length > 0);
}

async function normalizeArticles(
  source: FeedSource,
  articles: Omit<RawArticle, 'canonicalUrl' | 'fingerprint'>[],
): Promise<RawArticle[]> {
  const normalized: RawArticle[] = [];
  const seenUrls = new Set<string>();
  const seenFingerprints = new Set<string>();
  for (const article of articles) {
    const canonicalUrl = canonicalizeUrl(article.url);
    if (!canonicalUrl) continue;
    let fingerprint: string;
    try {
      fingerprint = await fingerprintFor(article.title, article.description, canonicalUrl);
    } catch {
      continue;
    }
    if (seenUrls.has(canonicalUrl) || seenFingerprints.has(fingerprint)) continue;
    seenUrls.add(canonicalUrl);
    seenFingerprints.add(fingerprint);
    normalized.push({ ...article, sourceId: source.id, canonicalUrl, fingerprint });
  }
  return normalized;
}

async function ensureSources(db: D1Database): Promise<void> {
  const now = Date.now();
  await db.batch(
    FEED_SOURCES.map((source) =>
      db
        .prepare(
          `INSERT INTO sources (
             id, kind, name, url, sport, comp, authority_score, enabled, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             kind = excluded.kind,
             name = excluded.name,
             url = excluded.url,
             sport = excluded.sport,
             comp = excluded.comp,
             authority_score = excluded.authority_score,
             updated_at = excluded.updated_at`,
        )
        .bind(
          source.id,
          source.kind,
          source.name,
          source.url,
          source.sport,
          source.comp ?? null,
          source.authorityScore,
          source.defaultEnabled ? 1 : 0,
          now,
          now,
        ),
    ),
  );
}

async function enabledSources(db: D1Database): Promise<FeedSource[]> {
  const result = await db
    .prepare('SELECT id FROM sources WHERE enabled = 1')
    .all<{ id: unknown }>();
  const enabled = new Set(
    (result.results ?? []).map((row) => (typeof row.id === 'string' ? row.id : '')).filter(Boolean),
  );
  return FEED_SOURCES.filter((source) => enabled.has(source.id));
}

/** Drop fingerprints already in `articles` so a tick only processes new work. */
export async function knownFingerprints(
  db: D1Database,
  fingerprints: string[],
): Promise<Set<string>> {
  const known = new Set<string>();
  for (let offset = 0; offset < fingerprints.length; offset += FINGERPRINT_LOOKUP_CHUNK) {
    const chunk = fingerprints.slice(offset, offset + FINGERPRINT_LOOKUP_CHUNK);
    const result = await db
      .prepare(
        `SELECT fingerprint FROM articles WHERE fingerprint IN (${chunk.map(() => '?').join(',')})`,
      )
      .bind(...chunk)
      .all<{ fingerprint: string }>();
    for (const row of result.results ?? []) known.add(row.fingerprint);
  }
  return known;
}

/** Drop normalized titles already stored so a story re-surfacing from a new
 *  outlet isn't re-enriched. Mirrors knownFingerprints; existing rows with a
 *  NULL title_norm never match, so only post-migration articles participate. */
async function knownTitles(db: D1Database, titles: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let offset = 0; offset < titles.length; offset += FINGERPRINT_LOOKUP_CHUNK) {
    const chunk = titles.slice(offset, offset + FINGERPRINT_LOOKUP_CHUNK);
    const result = await db
      .prepare(
        `SELECT title_norm FROM articles WHERE title_norm IN (${chunk.map(() => '?').join(',')})`,
      )
      .bind(...chunk)
      .all<{ title_norm: string }>();
    for (const row of result.results ?? []) known.add(row.title_norm);
  }
  return known;
}

export interface IngestReport {
  sources: number;
  fetched: number;
  /** Already stored, so never re-enriched. */
  skipped: number;
  /** Newly enriched and stored in this tick. */
  stored: number;
  failed: string[];
}

/** Fetch every source, drop stored fingerprints, then enrich and persist the
 *  survivors in one scheduled handler pass. A failed article is not stored,
 *  so the next tick re-fetches and re-enriches it. */
export async function ingestAllSources(env: Env, _ctx?: ExecutionContext): Promise<IngestReport> {
  if (!env.DB) throw new Error('D1 binding is required');
  await ensureSources(env.DB);
  const sources = await enabledSources(env.DB);

  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        const raw = await readSource(source, Date.now());
        const articles = await normalizeArticles(source, raw);
        return { source, articles, error: '' };
      } catch (error) {
        console.error(`[ingest] ${source.id} failed:`, error);
        return { source, articles: [], error: source.id };
      }
    }),
  );

  const fetched = results.flatMap((result) => result.articles);
  const known = await knownFingerprints(
    env.DB,
    fetched.map((article) => article.fingerprint),
  );
  let articles = fetched.filter((article) => !known.has(article.fingerprint));

  // Cross-source dedup: the same story syndicated across outlets has a
  // different fingerprint (hostname is part of it), so drop by normalized
  // title. First occurrence wins — FEED_SOURCES order puts high-authority
  // outlets first — and anything already stored is skipped.
  const seenTitles = new Set<string>();
  articles = articles.filter((article) => {
    const key = normalizeTitle(article.title);
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });
  const storedTitles = await knownTitles(
    env.DB,
    articles.map((article) => normalizeTitle(article.title)),
  );
  articles = articles.filter((article) => !storedTitles.has(normalizeTitle(article.title)));

  let stored = 0;
  if (articles.length > 0) {
    for (let offset = 0; offset < articles.length; offset += ENRICHMENT_BATCH_SIZE) {
      const chunk = articles.slice(offset, offset + ENRICHMENT_BATCH_SIZE);
      // Pull bodies for any teaser-only articles in this chunk before the
      // model call, in parallel so one slow publisher doesn't stall the tick.
      await Promise.all(chunk.map(fillBody));
      let enrichments: Awaited<ReturnType<typeof enrichBatch>>;
      try {
        enrichments = await enrichBatch(env, chunk);
      } catch (error) {
        // Keep anything already stored from earlier chunks. The next tick will
        // retry this chunk after its fingerprints remain absent from D1.
        console.error(`[ingest] enrichment failed for chunk at ${offset}:`, error);
        break;
      }

      for (const [index, article] of chunk.entries()) {
        const enrichment = enrichments[index];
        if (!enrichment) continue;
        try {
          await storeEnrichedArticle(env, article, enrichment);
          stored++;
        } catch (error) {
          console.error(`[ingest] ${article.sourceId} store failed:`, error);
        }
      }
    }
  }

  return {
    sources: sources.length,
    fetched: fetched.length,
    skipped: fetched.length - articles.length,
    stored,
    failed: results.map((result) => result.error).filter(Boolean),
  };
}
