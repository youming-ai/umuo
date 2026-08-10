import type { Env } from '../data/api';

const DAY_MS = 86_400_000;

/**
 * The cron that runs this sweep, as written in wrangler.jsonc. Both schedules
 * arrive at the same scheduled() handler, so this string is the only thing
 * telling a sweep apart from an ingest tick — change it in one place and the
 * daily run silently becomes a second full ingest, which is exactly what the
 * old duplicate "0 7 * * *" entry did. retention.cron.test.ts holds the two
 * copies together.
 */
export const PRUNE_CRON = '17 3 * * *';

/** Articles are archived, never deleted. Deleting them would drop the
 *  canonical_url and fingerprint rows that stop the same story being ingested
 *  and re-enriched on the next tick — retention would pay for itself in Gemini
 *  calls. `archived` simply drops out of the explore query's status filter. */
export const ARTICLE_ARCHIVE_DAYS = 90;

export interface RetentionReport {
  articlesArchived: number;
}

export async function pruneOldRecords(env: Env, now = Date.now()): Promise<RetentionReport> {
  if (!env.DB) throw new Error('D1 binding is required');
  // Both published and filtered rows age out — filtered stories (non-football
  // or off-topic) were never cleaned before, so they accumulated indefinitely.
  // Their fingerprints still guard against re-ingest, so archiving is safe.
  const result = await env.DB.prepare(
    `UPDATE articles SET status = 'archived', updated_at = ?
      WHERE status IN ('published', 'filtered') AND published_at < ?`,
  )
    .bind(now, now - ARTICLE_ARCHIVE_DAYS * DAY_MS)
    .run();

  return { articlesArchived: result.meta.changes ?? 0 };
}
