import type { Env } from '../data/api';

const DAY_MS = 86_400_000;

/** agent_runs is an audit trail of AI calls, not content. Two weeks is enough
 *  to investigate a bad tick; beyond that it is the largest table in the
 *  database and answers no question anyone asks. */
export const AGENT_RUN_RETENTION_DAYS = 14;

/** Articles are archived, never deleted. Deleting them would drop the
 *  canonical_url and fingerprint rows that stop the same story being ingested
 *  and re-enriched on the next tick — retention would pay for itself in Gemini
 *  calls. `archived` simply drops out of the explore query's status filter. */
export const ARTICLE_ARCHIVE_DAYS = 90;

export interface RetentionReport {
  agentRunsDeleted: number;
  articlesArchived: number;
}

export async function pruneOldRecords(env: Env, now = Date.now()): Promise<RetentionReport> {
  if (!env.DB) throw new Error('D1 binding is required');
  // ponytail: no index on agent_runs.started_at alone — this runs once a day
  // over a table holding at most a fortnight of rows, so a scan is cheaper
  // than an index maintained on every insert.
  const [runs, articles] = await env.DB.batch([
    env.DB.prepare('DELETE FROM agent_runs WHERE started_at < ?').bind(
      now - AGENT_RUN_RETENTION_DAYS * DAY_MS,
    ),
    env.DB.prepare(
      `UPDATE articles SET status = 'archived', updated_at = ?
        WHERE status = 'published' AND published_at < ?`,
    ).bind(now, now - ARTICLE_ARCHIVE_DAYS * DAY_MS),
  ]);

  return {
    agentRunsDeleted: runs.meta.changes ?? 0,
    articlesArchived: articles.meta.changes ?? 0,
  };
}
