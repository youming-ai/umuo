import { parseNewsFeed } from '../newsFeed';
import type { Env } from '../data/api';
import { FEED_SOURCES } from './sources';
import type { FeedSource, RawArticle } from './types';
import { parseRss } from './rss';

const MAX_QUEUE_BATCH = 100;
// The known-fingerprint lookup goes out in chunks so one statement never has
// to bind a whole tick's worth of articles — a tick fetches ~700 today and
// grows with every source added.
const FINGERPRINT_LOOKUP_CHUNK = 90;

// RSS publishers are fine with an honest bot agent, and all fourteen of them
// serve it, so they keep it.
const RSS_HEADERS = {
  accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, */*',
  'user-agent': 'umuo-football-news/1.0 (+https://umuo.app)',
};

// ESPN's WAF allow-lists client agents by name and 403s everything else. It is
// not fingerprint matching: measured against site.api, `curl/*`,
// `python-requests/*` and `Go-http-client/*` are served, while a browser UA, no
// UA at all, `Wget/*`, `node` and our own honest `umuo-football-news/1.0` are
// all refused. So the UA here is the one thing that decides whether the six
// api-json sources work, and it has to name an allow-listed client. See
// ESPN_HEADERS in src/data/api.ts — same host, same reason, keep them in sync.
const API_JSON_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'curl/8.7.1',
};

export function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
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
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) {
        return response;
      }
      if (attempt === 2) return response;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
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
        url: item.link,
        imageUrl: item.imageUrl,
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

/**
 * Fingerprints already in `articles`, so a tick only enqueues genuinely new
 * work. Best-effort by design: the queue consumer still does the
 * authoritative canonical_url + fingerprint check before the model is called.
 * Without
 * this every tick re-enqueued every article in every feed — ~450 messages
 * every 15 minutes that existed only to be recognised and dropped.
 */
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

export interface IngestReport {
  sources: number;
  fetched: number;
  /** Already stored, so never enqueued. */
  skipped: number;
  queued: number;
  failed: string[];
}

export async function ingestAllSources(env: Env, ctx: ExecutionContext): Promise<IngestReport> {
  void ctx;
  if (!env.DB || !env.INGEST_QUEUE) throw new Error('D1 and INGEST_QUEUE bindings are required');
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
  const articles = fetched.filter((article) => !known.has(article.fingerprint));
  for (let offset = 0; offset < articles.length; offset += MAX_QUEUE_BATCH) {
    const chunk = articles.slice(offset, offset + MAX_QUEUE_BATCH);
    await env.INGEST_QUEUE.sendBatch(chunk.map((body) => ({ body, contentType: 'json' as const })));
  }

  return {
    sources: sources.length,
    fetched: fetched.length,
    skipped: fetched.length - articles.length,
    queued: articles.length,
    failed: results.map((result) => result.error).filter(Boolean),
  };
}
