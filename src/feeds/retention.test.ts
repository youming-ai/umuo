// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../data/api';
import { ARTICLE_ARCHIVE_DAYS, pruneOldRecords } from './retention';

const DAY_MS = 86_400_000;
const NOW = 1_786_000_000_000;

function fakeEnv(changes = 7) {
  const bound: unknown[][] = [];
  const sql: string[] = [];
  const env = {
    DB: {
      prepare: (statement: string) => {
        sql.push(statement.replace(/\s+/g, ' ').trim());
        return {
          bind: (...params: unknown[]) => {
            bound.push(params);
            return { run: async () => ({ meta: { changes } }) };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, bound, sql };
}

describe('pruneOldRecords', () => {
  it('archives old articles instead of deleting them', async () => {
    const { env, bound, sql } = fakeEnv();
    await pruneOldRecords(env, NOW);

    // Deleting would drop the canonical_url/fingerprint rows that stop the same
    // story being re-ingested and re-enriched, so retention must not DELETE here.
    expect(sql[0]).toContain('UPDATE articles');
    expect(sql[0]).not.toContain('DELETE');
    expect(sql[0]).toContain("status = 'archived'");
    expect(bound[0]).toEqual([NOW, NOW - ARTICLE_ARCHIVE_DAYS * DAY_MS]);
  });

  it('archives both published and filtered articles', async () => {
    const { env, sql } = fakeEnv();
    await pruneOldRecords(env, NOW);
    // filtered stories (non-football/off-topic) must age out too — before this
    // they accumulated indefinitely because only 'published' was swept.
    expect(sql[0]).toContain("'published'");
    expect(sql[0]).toContain("'filtered'");
  });

  it('reports what it changed', async () => {
    const { env } = fakeEnv(40);
    expect(await pruneOldRecords(env, NOW)).toEqual({ articlesArchived: 40 });
  });

  it('throws without a D1 binding rather than silently doing nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(pruneOldRecords({} as Env, NOW)).rejects.toThrow('D1 binding is required');
  });
});
