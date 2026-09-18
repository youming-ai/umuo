// @vitest-environment node
// The bridge from Astro to the worker dispatcher.
//
// Placement is load-bearing twice over. Not under src/pages, because Astro
// treats every .ts file there as a file-based endpoint: a test colocated with
// its subject gets bundled as a deployed route (the build emitted
// dist/server/chunks/bridge_*.mjs), shipping the test inside the Worker and
// shadowing the [...route] catch-all for that path. Not under worker/ either,
// because tsconfig.worker.json compiles worker/** and would then pull an Astro
// route into the worker program, where Astro's Locals augmentation is out of
// scope. The root tsconfig covers both sides; this file lives in it.
//
// `src/pages/api/[...route].ts` is the ONLY path to `worker/index.ts`, and
// nothing tested it: the dispatcher's unit tests call `worker.fetch(...)`
// directly, so deleting or repointing that route file would 404 every
// `/api/explore` call — killing the island's data and its infinite scroll —
// while the suite stayed green. That is the same shape as the P1 this repo
// already shipped once (a /media route sitting in an unreachable file).
//
// Executed rather than asserted structurally: `cloudflare:workers` is mocked for
// its `env` binding and the real route runs against the real dispatcher.
import { describe, expect, it, vi } from 'vitest';

const { fakeEnv, kvGet } = vi.hoisted(() => {
  const get = vi.fn(async () => null);
  return {
    kvGet: get,
    fakeEnv: {
      CACHE: { get, put: vi.fn() },
      // A statement that succeeds and returns no rows: the point is that the
      // request reached queryExplore, not what it found there.
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(function bind(this: unknown) {
            return this;
          }),
          all: vi.fn(async () => ({ results: [], meta: { changes: 0 }, success: true })),
        })),
      },
      ASSETS: { fetch: vi.fn() },
    },
  };
});
vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));

import { ALL } from './pages/api/[...route]';

const cfContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
  tracing: {},
} as unknown as ExecutionContext;

function call(path: string): Promise<Response> {
  return ALL({
    request: new Request(`https://umuo.app${path}`),
    locals: { cfContext },
  } as never) as Promise<Response>;
}

describe('the /api/* bridge', () => {
  it('reaches the worker dispatcher and its data layer', async () => {
    const res = await call('/api/explore?limit=5');

    expect(res.status).toBe(200);
    // The request arrived at `serveExplore` with its query parsed: the SWR cache
    // was consulted under the current versioned key.
    expect(kvGet).toHaveBeenCalledWith(expect.stringContaining('explore:v4:'), 'json');
    const body = (await res.json()) as { items: unknown[]; nextCursor: unknown };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('exposes the dispatcher’s 404 for an unknown /api path', async () => {
    expect((await call('/api/nope')).status).toBe(404);
  });

  it('rejects a non-GET on the explore endpoint', async () => {
    const res = await ALL({
      request: new Request('https://umuo.app/api/explore', { method: 'POST' }),
      locals: { cfContext },
    } as never);
    expect((res as Response).status).toBe(405);
  });
});
