// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../data/api';
import { AGENT_RUN_RETENTION_DAYS, ARTICLE_ARCHIVE_DAYS, pruneOldRecords } from './retention';

const DAY_MS = 86_400_000;
const NOW = 1_786_000_000_000;

function fakeEnv(changes = [3, 7]) {
  const bound: unknown[][] = [];
  const sql: string[] = [];
  const env = {
    DB: {
      prepare: (statement: string) => {
        sql.push(statement.replace(/\s+/g, ' ').trim());
        return {
          bind: (...params: unknown[]) => {
            bound.push(params);
            return {};
          },
        };
      },
      batch: async () => changes.map((c) => ({ meta: { changes: c } })),
    },
  } as unknown as Env;
  return { env, bound, sql };
}

describe('pruneOldRecords', () => {
  it('deletes agent runs older than the retention window', async () => {
    const { env, bound, sql } = fakeEnv();
    await pruneOldRecords(env, NOW);

    expect(sql[0]).toContain('DELETE FROM agent_runs');
    expect(bound[0]).toEqual([NOW - AGENT_RUN_RETENTION_DAYS * DAY_MS]);
  });

  it('archives old articles instead of deleting them', async () => {
    const { env, bound, sql } = fakeEnv();
    await pruneOldRecords(env, NOW);

    // Deleting would drop the canonical_url/fingerprint rows that stop the same
    // story being re-ingested and re-enriched, so retention must not DELETE here.
    expect(sql[1]).toContain('UPDATE articles');
    expect(sql[1]).not.toContain('DELETE');
    expect(sql[1]).toContain("status = 'archived'");
    expect(bound[1]).toEqual([NOW, NOW - ARTICLE_ARCHIVE_DAYS * DAY_MS]);
  });

  it('only touches rows that are still published', async () => {
    const { env, sql } = fakeEnv();
    await pruneOldRecords(env, NOW);
    expect(sql[1]).toContain("status = 'published'");
  });

  it('reports what it changed', async () => {
    const { env } = fakeEnv([12, 40]);
    expect(await pruneOldRecords(env, NOW)).toEqual({
      agentRunsDeleted: 12,
      articlesArchived: 40,
    });
  });

  it('throws without a D1 binding rather than silently doing nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(pruneOldRecords({} as Env, NOW)).rejects.toThrow('D1 binding is required');
  });
});
