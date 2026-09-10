// @vitest-environment node
// serveExploreRss is the HTTP shell around the pure renderer: it normalises
// the query, goes through the SWR cache, and stamps the feed content type.
// exploreRss.test.ts covers the XML; this covers the wrapper — in particular
// the failure path, where the wrong header turns a 502 into a poisoned feed.
import { describe, expect, it, vi } from 'vitest';
import { SITE_ORIGIN } from '../site';
import type { Env } from './api';
import { serveExploreRss } from './api';

function mockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(async () => {}),
    passThroughOnException: vi.fn(),
    props: {},
    tracing: {},
  } as unknown as ExecutionContext;
}

/** D1 stub that records the LIMIT binding the explore query asks for and
 *  returns no rows. `failing` makes every statement throw, standing in for a
 *  D1 outage with nothing stored in KV. */
function mockEnv(options: { failing?: boolean } = {}): { env: Env; bindings: unknown[][] } {
  const bindings: unknown[][] = [];
  const env = {
    CACHE: { get: vi.fn(async () => null), put: vi.fn() },
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(function bind(this: unknown, ...args: unknown[]) {
          bindings.push(args);
          return this;
        }),
        all: vi.fn(async () => {
          if (options.failing) throw new Error('d1 down');
          return { results: [], meta: { changes: 0 }, success: true };
        }),
      })),
    },
  } as unknown as Env;
  return { env, bindings };
}

describe('serveExploreRss', () => {
  it('serves a rendered feed as application/rss+xml', async () => {
    const { env } = mockEnv();
    const res = await serveExploreRss({}, `${SITE_ORIGIN}/rss.xml`, SITE_ORIGIN, env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8');
    expect(await res.text()).toContain('<rss version="2.0"');
  });

  // Regression: the wrapper used to relabel runCached's JSON error body as
  // application/rss+xml AND stamp it `max-age=300`, so one D1 blip handed
  // every subscriber a parse error pinned in their HTTP cache for 5 minutes.
  it('passes a cold-cache upstream failure through untouched, never as a feed', async () => {
    const { env } = mockEnv({ failing: true });
    const res = await serveExploreRss({}, `${SITE_ORIGIN}/rss.xml`, SITE_ORIGIN, env, mockCtx());
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBeNull();
  });

  // A feed poll should carry more than the 12-item web default. 24 is the
  // ceiling normalizedExploreQuery clamps to; if that clamp ever drops below
  // it the request silently shrinks, so pin the number the query actually asks for.
  it('asks the query layer for a full 24-item page', async () => {
    const { env, bindings } = mockEnv();
    await serveExploreRss({}, `${SITE_ORIGIN}/rss.xml`, SITE_ORIGIN, env, mockCtx());
    // The explore query binds LIMIT last; it over-fetches by one to detect a
    // next page, so the feed page size shows up as 24 or 25.
    const limits = bindings.flat().filter((value): value is number => typeof value === 'number');
    expect(limits.some((value) => value === 24 || value === 25)).toBe(true);
  });

  it('scopes the channel link to the category it was given', async () => {
    const { env } = mockEnv();
    const res = await serveExploreRss(
      { category: 'tools' },
      `${SITE_ORIGIN}/tools/rss.xml`,
      SITE_ORIGIN,
      env,
      mockCtx(),
    );
    const xml = await res.text();
    expect(xml).toContain(`<link>${SITE_ORIGIN}/tools</link>`);
    expect(xml).toContain('Tools');
  });
});
