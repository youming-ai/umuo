/// <reference types="@cloudflare/workers-types" />
// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Env, json, serveExplore } from '../src/data/api';
import worker from './index';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

function mockEnv(kvData?: { body: string; at: number } | null): Env {
  // The explore cache key embeds the normalized query — tests don't need to
  // reproduce it, so a stored copy is returned regardless of the key asked.
  return {
    CACHE: {
      get: vi.fn(async () => (kvData ? { ...kvData } : null)),
      put: vi.fn(),
    },
    DB: mockDb(),
  } as unknown as Env;
}

// D1 mock: prepare() returns an object with both bind() and all() (the
// filters query calls all() without bind), `all` resolved to an empty result
// set unless overridden.
function mockDb(overrides?: { all?: ReturnType<typeof vi.fn> }): Env['DB'] {
  const all = overrides?.all ?? vi.fn().mockResolvedValue({ results: [] });
  return {
    prepare: vi.fn(() => ({ bind: vi.fn(() => ({ all })), all })),
  } as unknown as Env['DB'];
}

function mockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(async () => {}),
    passThroughOnException: vi.fn(),
    props: {},
    tracing: {},
  } as unknown as ExecutionContext;
}

// ---- json helper ----

describe('json helper', () => {
  it('creates a Response with JSON content-type', () => {
    const res = json('{"ok":true}', 200, 'MISS');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('x-cache')).toBe('MISS');
  });

  it('does not set cache-control headers (handled by downstream)', () => {
    const res = json('{"ok":true}', 200, 'HIT');
    expect(res.headers.get('cache-control')).toBeNull();
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('x-cache')).toBe('HIT');
  });

  it('handles error status codes', () => {
    const res = json('{"error":"upstream unavailable"}', 502, 'MISS');
    expect(res.status).toBe(502);
  });
});

// ---- runCached semantics via serveExplore ----

describe('serveExplore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HIT when stored body is fresh', async () => {
    const now = Date.now();
    const env = mockEnv({ body: '{"items":[],"nextCursor":null}', at: now - 30_000 }); // fresh is 60s
    const res = await serveExplore({}, env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(await res.text()).toBe('{"items":[],"nextCursor":null}');
  });

  it('returns MISS on first query with no stored data', async () => {
    const env = mockEnv(null);
    const res = await serveExplore({}, env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(await res.text()).toBe('{"items":[],"nextCursor":null}');
  });

  it('treats a KV read failure as a miss and still serves (no 500)', async () => {
    const env = mockEnv(null);
    vi.mocked(env.CACHE.get).mockRejectedValueOnce(new Error('kv down'));
    const res = await serveExplore({}, env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
  });

  it('returns STALE when the DB query fails but a stored copy exists', async () => {
    const now = Date.now();
    const env = mockEnv({ body: '{"items":[],"nextCursor":null}', at: now - 600_000 });
    const failing = vi.fn().mockRejectedValueOnce(new Error('D1 down'));
    env.DB = mockDb({ all: failing });
    const res = await serveExplore({}, env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('STALE');
  });

  it('returns 502 when the DB query fails and no stored copy exists', async () => {
    const env = mockEnv(null);
    const failing = vi.fn().mockRejectedValueOnce(new Error('D1 down'));
    env.DB = mockDb({ all: failing });
    const res = await serveExplore({}, env, mockCtx());
    expect(res.status).toBe(502);
    expect(res.headers.get('x-cache')).toBe('MISS');
  });

  it('caches the produced body in KV after a MISS', async () => {
    const env = mockEnv(null);
    const ctx = mockCtx();
    await serveExplore({}, env, ctx);
    expect(ctx.waitUntil).toHaveBeenCalled();
    expect((env.CACHE as ReturnType<typeof mockEnv>['CACHE']).put).toHaveBeenCalled();
  });

  it('lets N coalesced callers each read the body without `Body is unusable`', async () => {
    // Regression guard for the body-reuse bug: if `inflight` ever stored
    // `Promise<Response>`, the second caller reading `.text()` on the shared
    // body would throw `Body is unusable: Body has already been read`.
    const gate = Promise.withResolvers<void>();
    const slowAll = vi.fn(async () => {
      await gate.promise;
      return { results: [] };
    });
    const env = mockEnv(null);
    env.DB = mockDb({ all: slowAll });

    const N = 10;
    const responses = Array.from({ length: N }, () => serveExplore({}, env, mockCtx()));
    gate.resolve();

    const settled = await Promise.all(responses);
    expect(slowAll).toHaveBeenCalledTimes(1);
    expect(settled).toHaveLength(N);

    const bodies = await Promise.all(settled.map((r) => r.text()));
    expect(bodies.every((b) => b === '{"items":[],"nextCursor":null}')).toBe(true);
  });

  it('bypasses KV entirely for free-text search', async () => {
    const env = mockEnv({ body: '{"items":[],"nextCursor":null}', at: Date.now() });
    const res = await serveExplore({ q: 'transfer' }, env, mockCtx());
    expect(res.headers.get('x-cache')).toBe('MISS'); // never a HIT from KV
    expect((env.CACHE as ReturnType<typeof mockEnv>['CACHE']).get).not.toHaveBeenCalled();
  });
});

// ---- fetch routing ----

describe('fetch routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes GET /api/explore through serveExplore', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(new Request('https://x/api/explore'), env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
  });

  it('rejects non-GET on /api/explore', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(
      new Request('https://x/api/explore', { method: 'POST' }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(405);
  });

  it('routes /api/explore/filters through serveExploreFilters', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(
      new Request('https://x/api/explore/filters?comp=eng.1'),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ competitions: [], sources: [], tags: [] });
  });

  it('404s on an unknown /api/ path', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(new Request('https://x/api/eng.1/scoreboard'), env, mockCtx());
    expect(res.status).toBe(404);
  });

  it('404s on an unknown competition key', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(new Request('https://x/api/nope/scoreboard'), env, mockCtx());
    expect(res.status).toBe(404);
  });

  it('the RSS surface is no longer dispatched from /api/explore/rss', async () => {
    // The RSS feed moved to /rss.xml and /<comp>/rss.xml (Astro page
    // endpoints); /api/* is reserved for JSON. A stray /api/explore/rss hit
    // should 404 rather than fall through to JSON or a generic ASSETS miss.
    const env = mockEnv(null);
    const res = await worker.fetch(new Request('https://x/api/explore/rss'), env, mockCtx());
    expect(res.status).toBe(404);
  });

  it('rejects GET on the re-enrich backfill endpoint', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(new Request('https://x/api/re-enrich'), env, mockCtx());
    expect(res.status).toBe(405);
  });

  it('rejects the re-enrich endpoint without the LLM key', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(
      new Request('https://x/api/re-enrich', { method: 'POST' }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(401);
  });

  it('rejects the re-enrich endpoint with the wrong bearer token', async () => {
    const env = { ...mockEnv(null), LLM_API_KEY: 'secret' } as Env;
    const res = await worker.fetch(
      new Request('https://x/api/re-enrich', {
        method: 'POST',
        headers: { authorization: 'Bearer nope' },
      }),
      env,
      mockCtx(),
    );
    expect(res.status).toBe(401);
  });
});
