// @vitest-environment node
// getDeskStats is the page's "today's desk" summary. These tests pin the
// shape callers can rely on without spinning up a real D1 — an in-memory
// `db.batch()` replacement + a Map-backed KV stub is enough.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './api';
import { getDeskStats } from './api';

interface CountRow {
  total?: number;
  newest?: number;
}

// Mock that honours every `prepare(...).bind(...)` chain the api code uses,
// then hands out a row from a fixed `rows` queue per `.all()` call. Each
// prepare()-statement gets its own row, in the order batch() sees it.
function mockEnv(rows: CountRow[], kvGet: ReturnType<typeof vi.fn> = vi.fn(async () => null)): Env {
  let queue = [...rows];
  return {
    CACHE: { get: kvGet, put: vi.fn() },
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(function bind(this: unknown) {
          return this;
        }),
        all: vi.fn(async () => {
          const row = queue.shift() ?? {};
          return { results: [row], meta: { changes: 0 }, success: true };
        }),
      })),
      batch: vi.fn(async (statements: unknown[]) => {
        // Replay every statement's `.all()` and return those results in order.
        const out: { results: unknown[]; meta: { changes: number }; success: boolean }[] = [];
        for (const stmt of statements) {
          // biome-ignore lint/suspicious/noExplicitAny: mock of a dynamic D1 statement
          const all = (stmt as any).all;
          out.push(await all());
        }
        return out;
      }),
    },
  } as unknown as Env;
}

function mockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(async () => {}),
    passThroughOnException: vi.fn(),
    props: {},
    tracing: {},
  } as unknown as ExecutionContext;
}

describe('getDeskStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums source_health fetched + counts today's published and filtered", async () => {
    const env = mockEnv([{ total: 1247 }, { total: 84 }, { total: 19 }, { newest: 1786700000000 }]);
    const stats = await getDeskStats(env, mockCtx());
    expect(stats).toEqual({
      fetchedAllTime: 1247,
      published: 84,
      filtered: 19,
      lastIngestedAt: 1786700000000,
    });
    expect((env.DB as ReturnType<typeof mockEnv>['DB']).batch).toHaveBeenCalledTimes(1);
  });

  it('collapses a downstream failure into zeros, never throws', async () => {
    const env = mockEnv([], vi.fn().mockRejectedValue(new Error('kv down')));
    (env.DB as ReturnType<typeof mockEnv>['DB']).batch = vi.fn(async () => {
      throw new Error('d1 down');
    });
    const stats = await getDeskStats(env, mockCtx());
    expect(stats).toEqual({ fetchedAllTime: 0, published: 0, filtered: 0, lastIngestedAt: 0 });
  });

  it('reads through KV cache when a stored copy is fresh', async () => {
    const stored = JSON.stringify({
      fetchedAllTime: 50,
      published: 10,
      filtered: 2,
      lastIngestedAt: 1786700000000,
    });
    const env = mockEnv(
      [],
      vi.fn(async () => ({ body: stored, at: Date.now() })),
    );
    const stats = await getDeskStats(env, mockCtx());
    expect(stats).toEqual({
      fetchedAllTime: 50,
      published: 10,
      filtered: 2,
      lastIngestedAt: 1786700000000,
    });
    expect((env.DB as ReturnType<typeof mockEnv>['DB']).batch).not.toHaveBeenCalled();
  });

  it('coerces non-numeric D1 rows into zeros rather than throwing', async () => {
    const env = mockEnv([{}, {}, {}, {}]);
    const stats = await getDeskStats(env, mockCtx());
    expect(stats.fetchedAllTime).toBe(0);
    expect(stats.published).toBe(0);
    expect(stats.filtered).toBe(0);
    expect(stats.lastIngestedAt).toBe(0);
  });

  it('scopes published, filtered, and lastIngestedAt to a competition when given', async () => {
    const env = mockEnv([
      { total: 1247 }, // source_health SUM — global, never per-comp
      { total: 24 }, // published WHERE comp = ?
      { total: 3 }, // filtered WHERE comp = ?
      { newest: 1786900000000 },
    ]);
    const stats = await getDeskStats(env, mockCtx(), 'eng.1');
    // The input tally is global on purpose: source_health has no comp column.
    expect(stats).toEqual({
      fetchedAllTime: 1247,
      published: 24,
      filtered: 3,
      lastIngestedAt: 1786900000000,
    });
  });

  it('uses a different KV key for the per-comp variant', async () => {
    // Regression: if home (`comp=undefined`) and `/eng.1` share a cache key,
    // every SSR page will pin the home numbers for the league pages. Confirm
    // they diverge by reading the underlying cache key passed in.
    const seenKeys: string[] = [];
    const kvGet = vi.fn().mockImplementation(async (key: string) => {
      seenKeys.push(key);
      return null;
    });
    const home = mockEnv([{ total: 1 }, { total: 1 }, { total: 1 }, { newest: 1 }], kvGet);
    const league = mockEnv([{ total: 1 }, { total: 1 }, { total: 1 }, { newest: 1 }], kvGet);
    await getDeskStats(home, mockCtx());
    await getDeskStats(league, mockCtx(), 'uefa.champions');
    expect(seenKeys).toContain('desk:stats:v1');
    expect(seenKeys).toContain('desk:stats:v1:comp:uefa.champions');
  });

  it('ignores an unknown comp and falls back to the global path', async () => {
    const env = mockEnv([{ total: 50 }, { total: 10 }, { total: 2 }, { newest: 99 }]);
    const stats = await getDeskStats(env, mockCtx(), 'nope.not.in.registry');
    // No per-comp filter applied; counts read the global art.
    expect(stats.published).toBe(10);
  });

  // Regression: the strip renders keep / reject / last as one "today" row, so
  // every article-side statement has to carry the same day bound. Unbounded,
  // `last` printed yesterday's clock time beside "keep 0 / reject 0" — and
  // beside the "has not run an ingest tick today yet" note.
  it('bounds published, filtered, and last to the same UTC day', async () => {
    const env = mockEnv([{ total: 1 }, { total: 1 }, { total: 1 }, { newest: 1 }]);
    await getDeskStats(env, mockCtx());
    const prepare = vi.mocked((env.DB as ReturnType<typeof mockEnv>['DB']).prepare);
    const sql = prepare.mock.calls.map(([statement]) => statement);
    const articleSide = sql.filter((statement: string) => statement.includes('FROM articles'));
    expect(articleSide).toHaveLength(3);
    for (const statement of articleSide) {
      expect(statement).toContain('created_at >= ?');
    }
    // The input tally is the one all-time number and must stay unbounded.
    const inputSide = sql.filter((statement: string) => statement.includes('source_health'));
    expect(inputSide[0]).not.toContain('created_at');
  });
});
