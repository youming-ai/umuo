import { parseNewsFeed } from '../newsFeed';
import type { Env } from '../data/api';
import { FEED_SOURCES } from './sources';
import type { FeedSource, RawArticle } from './types';
import { parseRss } from './rss';

const USER_AGENT = 'umuo-football-news/1.0 (+https://cup.umuo.app)';
const MAX_QUEUE_BATCH = 100;

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

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, */*',
          'user-agent': USER_AGENT,
        },
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
  const response = await fetchWithRetry(source.url);
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
    FEED_SOURCES.flatMap((source) => [
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
      db.prepare('INSERT OR IGNORE INTO source_health (source_id) VALUES (?)').bind(source.id),
    ]),
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

async function recordSourceSuccess(
  db: D1Database,
  sourceId: string,
  fetched: number,
  latency: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE source_health
       SET last_fetch_at = ?, last_success_at = ?, consecutive_failures = 0,
           avg_latency_ms = CASE
             WHEN avg_latency_ms = 0 THEN ?
             ELSE CAST((avg_latency_ms * 4 + ?) / 5 AS INTEGER)
           END,
           articles_fetched_count = articles_fetched_count + ?
       WHERE source_id = ?`,
    )
    .bind(Date.now(), Date.now(), latency, latency, fetched, sourceId)
    .run();
}

async function recordSourceFailure(db: D1Database, sourceId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE source_health
       SET last_fetch_at = ?, consecutive_failures = consecutive_failures + 1
       WHERE source_id = ?`,
    )
    .bind(Date.now(), sourceId)
    .run();
}

export interface IngestReport {
  sources: number;
  fetched: number;
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
      const started = Date.now();
      try {
        const raw = await readSource(source, started);
        const articles = await normalizeArticles(source, raw);
        await recordSourceSuccess(env.DB, source.id, articles.length, Date.now() - started);
        return { source, articles, error: '' };
      } catch (error) {
        await recordSourceFailure(env.DB, source.id);
        console.error(`[ingest] ${source.id} failed:`, error);
        return { source, articles: [], error: source.id };
      }
    }),
  );

  const articles = results.flatMap((result) => result.articles);
  for (let offset = 0; offset < articles.length; offset += MAX_QUEUE_BATCH) {
    const chunk = articles.slice(offset, offset + MAX_QUEUE_BATCH);
    await env.INGEST_QUEUE.sendBatch(chunk.map((body) => ({ body, contentType: 'json' as const })));
  }

  return {
    sources: sources.length,
    fetched: articles.length,
    queued: articles.length,
    failed: results.map((result) => result.error).filter(Boolean),
  };
}
