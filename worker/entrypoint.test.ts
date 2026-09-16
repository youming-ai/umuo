/// <reference types="@cloudflare/workers-types" />
// @vitest-environment node
// The deployed fetch handler is this entrypoint, not worker/index.ts: Astro only
// mounts that dispatcher at /api/*, so a /media/ route placed there is
// unreachable and every proxied image 404s against ASSETS. These tests pin the
// wiring — media is answered *before* Astro's handler is consulted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/data/api';

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock('@astrojs/cloudflare/handler', () => ({ handle }));

import entrypoint from './entrypoint';

type EntryRequest = Parameters<NonNullable<typeof entrypoint.fetch>>[0];

/** ExportedHandler types `fetch` with Cloudflare's incoming-request generics,
 *  which a plain `new Request()` does not satisfy. Cast in one place. */
function request(url: string, init?: RequestInit): EntryRequest {
  return new Request(url, init) as unknown as EntryRequest;
}

const ENV = {} as unknown as Env;
const ID = '437e368b-c40c-4e02-8e06-2ca5bbcb8055';

function mockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
    tracing: {},
  } as unknown as ExecutionContext;
}

describe('entrypoint fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh Response per call: a shared one has its body consumed by the first
    // reader.
    handle.mockImplementation(async () => new Response('astro', { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers /media/<id> itself, without consulting Astro', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('image-bytes', { status: 200, headers: { 'content-type': 'image/png' } }),
        ),
    );

    const res = await entrypoint.fetch!(request(`https://x/media/${ID}`), ENV, mockCtx());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(handle).not.toHaveBeenCalled();
  });

  it('delegates every other path to Astro', async () => {
    for (const path of ['/', '/a/abc', '/api/explore', '/rss.xml']) {
      const res = await entrypoint.fetch!(request(`https://x${path}`), ENV, mockCtx());
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe('astro');
    }
    expect(handle).toHaveBeenCalledTimes(4);
  });

  it('404s a /media/ path that is not a storage id, still without Astro', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await entrypoint.fetch!(request('https://x/media/not-a-uuid'), ENV, mockCtx());

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it('rejects a non-GET on /media/', async () => {
    const res = await entrypoint.fetch!(
      request(`https://x/media/${ID}`, { method: 'POST' }),
      ENV,
      mockCtx(),
    );
    expect(res.status).toBe(405);
    expect(handle).not.toHaveBeenCalled();
  });
});
