// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Env } from './api';
import { getGoogleNewsSitemapArticles } from './sitemapData';

function mockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
    tracing: {},
  } as unknown as ExecutionContext;
}

describe('getGoogleNewsSitemapArticles', () => {
  it('only queries stored news articles and uses a new cache key', async () => {
    let sql = '';
    const env = {
      CACHE: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      },
      DB: {
        prepare: vi.fn((query: string) => {
          sql = query;
          return {
            bind: vi.fn(() => ({
              all: vi.fn().mockResolvedValue({ results: [] }),
            })),
          };
        }),
      },
    } as unknown as Env;

    expect(await getGoogleNewsSitemapArticles(env, mockCtx(), Date.now())).toEqual([]);
    expect(sql).toContain("article_type = 'news'");
    expect(env.CACHE.get).toHaveBeenCalledWith('sitemap:google-news:v2', 'json');
  });
});
