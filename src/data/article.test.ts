// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../data/api';
import { serveArticleRedirect } from '../data/article';

const ID = '3ff451bfb002a571e5a2f2a6c3934f71a474bae3354d6800383c744495119e60';

function mockDb(row?: { canonical_url: string }): Env['DB'] {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => row),
      })),
    })),
  } as unknown as Env['DB'];
}

describe('serveArticleRedirect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('301s a known id to its canonical source URL', async () => {
    const env = { DB: mockDb({ canonical_url: 'https://example.com/story' }) } as unknown as Env;
    const res = await serveArticleRedirect(ID, env);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://example.com/story');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
  });

  it('404s an unknown id', async () => {
    const env = { DB: mockDb(undefined) } as unknown as Env;
    const res = await serveArticleRedirect('nope', env);
    expect(res.status).toBe(404);
  });

  it('404s a row without a canonical URL rather than redirecting to nothing', async () => {
    const env = { DB: mockDb({ canonical_url: '' }) } as unknown as Env;
    expect((await serveArticleRedirect(ID, env)).status).toBe(404);
  });

  it('502s when the lookup fails, instead of 404ing a live link', async () => {
    const prepare = vi.fn(() => {
      throw new Error('D1 down');
    });
    const env = { DB: { prepare } } as unknown as Env;
    const res = await serveArticleRedirect(ID, env);
    expect(res.status).toBe(502);
  });
});
