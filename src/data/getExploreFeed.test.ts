// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './api';
import { getExploreFeed } from './api';

// getExploreFeed re-parses the JSON that serveExplore cached, so its type
// guards have to track ExploreFeed. They did not: nextCursor became a keyset
// string in the keyset-pagination change while this still tested for a number,
// which silently coerced every server-rendered page to nextCursor: null. The
// feed reported itself exhausted on first paint and infinite scroll never
// started — invisible to the /api/explore tests, which read the raw response.
function envReturning(body: unknown): Env {
  const json = JSON.stringify(body);
  return {
    CACHE: {
      get: vi.fn().mockResolvedValue({ body: json, at: Date.now() }),
      put: vi.fn(),
    },
  } as unknown as Env;
}

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

afterEach(() => vi.restoreAllMocks());

describe('getExploreFeed', () => {
  it('keeps a keyset cursor instead of dropping it', async () => {
    const cursor = '1786080856000:2cfd02576735e225';
    const feed = await getExploreFeed(
      {},
      envReturning({ items: [{ id: 'a' }], nextCursor: cursor }),
      ctx,
    );

    expect(feed.nextCursor).toBe(cursor);
    expect(feed.items).toHaveLength(1);
  });

  it('reports an exhausted feed as null', async () => {
    const feed = await getExploreFeed({}, envReturning({ items: [], nextCursor: null }), ctx);
    expect(feed.nextCursor).toBeNull();
  });

  it('rejects a cursor of the wrong shape rather than passing it through', async () => {
    // A stale cache entry written before the keyset change holds a number.
    const feed = await getExploreFeed({}, envReturning({ items: [], nextCursor: 12 }), ctx);
    expect(feed.nextCursor).toBeNull();
  });

  it('generates valid SQL containing FROM articles a on cache miss with category', async () => {
    let capturedSql = '';
    let capturedBindings: unknown[] = [];

    const env = {
      CACHE: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      },
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => {
          capturedSql = sql;
          return {
            bind: vi.fn().mockImplementation((...bindings: unknown[]) => {
              capturedBindings = bindings;
              return {
                all: vi.fn().mockResolvedValue({ results: [] }),
              };
            }),
          };
        }),
      },
    } as unknown as Env;

    const feed = await getExploreFeed({ category: 'tools' }, env, ctx);
    expect(feed.items).toEqual([]);
    expect(capturedSql).toContain('FROM articles a');
    // EXPLORE_ARTICLE_COLUMNS reads nothing from `sources` any more, so the
    // join that used to hang off every feed query is gone.
    expect(capturedSql).not.toContain('JOIN sources');
    expect(capturedSql).toContain('a.category = ?');
    expect(capturedBindings).toContain('tools');
  });
});

describe('getExploreFeed degradation', () => {
  it('marks an unreadable feed instead of reporting an empty one', async () => {
    // The distinction is the whole point: without it a D1 or KV outage renders
    // as "No links match these filters" — the reader is told their filters are
    // too narrow while the site is down, and nothing surfaces the failure.
    const failing = {
      CACHE: { get: vi.fn().mockRejectedValue(new Error('kv down')), put: vi.fn() },
    } as unknown as Env;

    const feed = await getExploreFeed({}, failing, ctx);
    expect(feed.items).toEqual([]);
    expect(feed.unavailable).toBe(true);
  });

  it('does not mark a feed that legitimately holds nothing', async () => {
    const feed = await getExploreFeed({}, envReturning({ items: [], nextCursor: null }), ctx);
    expect(feed.unavailable).toBeUndefined();
  });
});
