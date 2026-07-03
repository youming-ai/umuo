/// <reference types="@cloudflare/workers-types" />
// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env, json, serve, serveLeaders, serveSummary } from './index';
import { COMPETITIONS } from '../src/competitions';

const WC = COMPETITIONS['fifa.world'];

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

// ---- serve function ----

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

function mockEnv(kvData?: { body: string; at: number } | null, key = 'fifa.world:standings') {
  const store = new Map<string, string>();
  if (kvData) {
    store.set(key, JSON.stringify(kvData));
  }
  return {
    CACHE: {
      get: vi.fn(async (k: string) => {
        const v = store.get(k);
        return v ? JSON.parse(v) : null;
      }),
      put: vi.fn(async (k: string, value: string) => {
        store.set(k, value);
      }),
    },
  };
}

function mockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(async () => {}),
    passThroughOnException: vi.fn(),
    props: {},
    tracing: {},
  } as unknown as ExecutionContext;
}

describe('serve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HIT when stored body is fresh', async () => {
    const now = Date.now();
    const storedAt = now - 30_000; // 30s ago — fresh is 300s
    const env = mockEnv({ body: '{"data":"cached"}', at: storedAt });
    const ctx = mockCtx();

    const res = await serve(WC, 'standings', env as unknown as Env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');
    const body = await res.text();
    expect(body).toBe('{"data":"cached"}');
  });

  it('returns MISS on first fetch with no stored data', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '{"data":"fresh"}' });

    const env = mockEnv(null);
    const ctx = mockCtx();

    const res = await serve(WC, 'standings', env as unknown as Env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    const body = await res.text();
    expect(body).toBe('{"data":"fresh"}');
  });

  it('returns REVALIDATED when stored data is stale but fetch succeeds', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '{"data":"updated"}' });

    const now = Date.now();
    const storedAt = now - 600_000; // 10min ago — stale (fresh is 300s)
    const env = mockEnv({ body: '{"data":"old"}', at: storedAt });
    const ctx = mockCtx();

    const res = await serve(WC, 'standings', env as unknown as Env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('REVALIDATED');
    const body = await res.text();
    expect(body).toBe('{"data":"updated"}');
  });

  it('returns STALE when upstream fails but a stored copy exists', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    const now = Date.now();
    const storedAt = now - 600_000; // stale
    const env = mockEnv({ body: '{"data":"stale"}', at: storedAt });
    const ctx = mockCtx();

    const res = await serve(WC, 'standings', env as unknown as Env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('STALE');
    const body = await res.text();
    expect(body).toBe('{"data":"stale"}');
  });

  it('returns 502 when upstream fails and no stored copy exists', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    const env = mockEnv(null);
    const ctx = mockCtx();

    const res = await serve(WC, 'standings', env as unknown as Env, ctx);
    expect(res.status).toBe(502);
    expect(res.headers.get('x-cache')).toBe('MISS');
    const body = await res.text();
    expect(body).toBe('{"error":"upstream unavailable"}');
  });

  it('returns 502 when upstream responds with non-ok and no stored copy', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Internal Error' });

    const env = mockEnv(null);
    const ctx = mockCtx();

    const res = await serve(WC, 'standings', env as unknown as Env, ctx);
    expect(res.status).toBe(502);
    expect(res.headers.get('x-cache')).toBe('MISS');
  });

  it('caches the fresh upstream body in KV after a MISS', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '{"data":"to-cache"}' });

    const env = mockEnv(null);
    const ctx = mockCtx();

    await serve(WC, 'standings', env as unknown as Env, ctx);
    expect(ctx.waitUntil).toHaveBeenCalled();
    expect((env.CACHE as ReturnType<typeof mockEnv>['CACHE']).put).toHaveBeenCalled();
  });

  it('lets N coalesced callers each read the body without `Body is unusable`', async () => {
    // Regression guard for the body-reuse bug: if `inflight` ever stored
    // `Promise<Response>`, the second caller reading `.text()` on the shared
    // body would throw `Body is unusable: Body has already been read`. With
    // the fix (shared payload is a plain object; each caller rebuilds its
    // own Response), all N concurrent readers must succeed.
    const gate = Promise.withResolvers<void>();
    fetchMock.mockImplementationOnce(async () => {
      await gate.promise;
      return { ok: true, text: async () => '{"data":"fan-out"}' };
    });

    const env = mockEnv(null);
    const ctx = mockCtx();

    const N = 10;
    const responses = Array.from({ length: N }, () =>
      serve(WC, 'standings', env as unknown as Env, ctx),
    );
    gate.resolve();

    const settled = await Promise.all(responses);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settled).toHaveLength(N);

    const bodies = await Promise.all(settled.map((r) => r.text()));
    expect(bodies.every((b) => b === '{"data":"fan-out"}')).toBe(true);
  });
});

describe('serveSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for a non-numeric event id', async () => {
    const env = mockEnv(null);
    const res = await serveSummary(WC, 'abc; DROP', env as unknown as Env, mockCtx());
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty event id', async () => {
    const env = mockEnv(null);
    const res = await serveSummary(WC, '', env as unknown as Env, mockCtx());
    expect(res.status).toBe(400);
  });

  it('fetches and caches the ESPN summary for a numeric id', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '{"boxscore":{}}' });
    const env = mockEnv(null);
    const ctx = mockCtx();
    const res = await serveSummary(WC, '760420', env as unknown as Env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(await res.text()).toBe('{"boxscore":{}}');
    expect((env.CACHE as ReturnType<typeof mockEnv>['CACHE']).put).toHaveBeenCalledWith(
      'summary:fifa.world:760420',
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });
});

describe('serveLeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // nba is a pipeline comp; season is derived at request time. We assert cache
  // semantics via the KV mock (HIT/MISS/STALE), not the exact upstream URLs —
  // assembleLeaders itself is unit-tested in src/leaders.test.ts.
  const NBA = COMPETITIONS.nba;

  it('returns HIT with the stored Leader[] when fresh', async () => {
    const now = Date.now();
    const cached = JSON.stringify([
      { rank: 1, name: 'L. James', teamName: 'Lakers', teamLogo: '', displayValue: '30.2', value: 30.2 },
    ]);
    const env = mockEnv({ body: cached, at: now - 60_000 }, 'nba:leaders'); // fresh is 3600s
    const res = await serveLeaders(NBA, env as unknown as Env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(await res.text()).toBe(cached);
    expect(fetchMock).not.toHaveBeenCalled(); // fresh HIT never runs the producer
  });

  it('runs the producer and caches its result on a MISS', async () => {
    // The producer (assembleLeaders) fetches the leaders doc then athlete/team
    // refs. Canned: an empty categories payload → assembleLeaders returns [].
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ categories: [] }) });
    const env = mockEnv(null, 'nba:leaders');
    const ctx = mockCtx();
    const res = await serveLeaders(NBA, env as unknown as Env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(await res.text()).toBe('[]');
    expect(ctx.waitUntil).toHaveBeenCalled();
    expect((env.CACHE as ReturnType<typeof mockEnv>['CACHE']).put).toHaveBeenCalledWith(
      'nba:leaders',
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it('serves a STALE stored copy when the producer throws', async () => {
    fetchMock.mockRejectedValue(new Error('core.api down'));
    const stale = JSON.stringify([{ rank: 1, name: 'x', teamName: '', teamLogo: '', displayValue: '1', value: 1 }]);
    const env = mockEnv({ body: stale, at: Date.now() - 7_200_000 }, 'nba:leaders'); // stale (fresh 3600s)
    const res = await serveLeaders(NBA, env as unknown as Env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('STALE');
    expect(await res.text()).toBe(stale);
  });
});

describe('fetch routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('404s on an unknown competition key', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(
      new Request('https://x/api/nope/scoreboard'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s on a prototype-name competition key', async () => {
    // A bare truthy index (COMPETITIONS[m[1]]) would resolve 'constructor' to
    // Object.prototype.constructor and wrongly treat it as a known competition.
    const env = mockEnv(null);
    const res = await worker.fetch(
      new Request('https://x/api/constructor/scoreboard'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes a known competition scoreboard through serve', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '{"events":[]}' });
    const env = mockEnv(null);
    const res = await worker.fetch(
      new Request('https://x/api/fifa.world/scoreboard'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(await res.text()).toBe('{"events":[]}');
  });

  it('routes a known competition leaders through serveLeaders', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ categories: [] }) });
    const env = mockEnv(null, 'nba:leaders');
    const res = await worker.fetch(
      new Request('https://x/api/nba/leaders'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[]');
  });

  it('404s on leaders for an unknown competition key', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(
      new Request('https://x/api/nope/leaders'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(res.status).toBe(404);
  });

  it('404s on an unknown /api/ path', async () => {
    const env = mockEnv(null);
    const res = await worker.fetch(
      new Request('https://x/api/fifa.world/nonsense'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(res.status).toBe(404);
  });
});
