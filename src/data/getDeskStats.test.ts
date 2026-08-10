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
      fetched: 1247,
      published: 84,
      filtered: 19,
      lastPublishedAt: 1786700000000,
    });
    expect((env.DB as ReturnType<typeof mockEnv>['DB']).batch).toHaveBeenCalledTimes(1);
  });

  it('collapses a downstream failure into zeros, never throws', async () => {
    const env = mockEnv([], vi.fn().mockRejectedValue(new Error('kv down')));
    (env.DB as ReturnType<typeof mockEnv>['DB']).batch = vi.fn(async () => {
      throw new Error('d1 down');
    });
    const stats = await getDeskStats(env, mockCtx());
    expect(stats).toEqual({ fetched: 0, published: 0, filtered: 0, lastPublishedAt: 0 });
  });

  it('reads through KV cache when a stored copy is fresh', async () => {
    const stored = JSON.stringify({
      fetched: 50,
      published: 10,
      filtered: 2,
      lastPublishedAt: 1786700000000,
    });
    const env = mockEnv(
      [],
      vi.fn(async () => ({ body: stored, at: Date.now() })),
    );
    const stats = await getDeskStats(env, mockCtx());
    expect(stats).toEqual({
      fetched: 50,
      published: 10,
      filtered: 2,
      lastPublishedAt: 1786700000000,
    });
    expect((env.DB as ReturnType<typeof mockEnv>['DB']).batch).not.toHaveBeenCalled();
  });

  it('coerces non-numeric D1 rows into zeros rather than throwing', async () => {
    const env = mockEnv([{}, {}, {}, {}]);
    const stats = await getDeskStats(env, mockCtx());
    expect(stats.fetched).toBe(0);
    expect(stats.published).toBe(0);
    expect(stats.filtered).toBe(0);
    expect(stats.lastPublishedAt).toBe(0);
  });
});
