import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN } from '../site';
import { GET } from './sitemap.xml';

async function render(): Promise<{ status: number; contentType: string | null; body: string }> {
  // GET ignores its context; a bare object satisfies the APIRoute signature.
  const res = await GET({} as never);
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    body: await res.text(),
  };
}

describe('sitemap.xml', () => {
  it('serves valid XML with the sitemap namespace', async () => {
    const { status, contentType, body } = await render();
    expect(status).toBe(200);
    expect(contentType).toContain('application/xml');
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(body.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('lists each competition news feed and team directory', async () => {
    const { body } = await render();
    for (const path of [
      '/fifa.world/news',
      '/eng.1/news',
      '/nba/news',
      '/fifa.world/teams',
      '/eng.1/teams',
      '/nba/teams',
    ]) {
      expect(body).toContain(`<loc>${SITE_ORIGIN}${path}</loc>`);
    }
  });

  it('lists each competition landing + its enabled sections', async () => {
    const { body } = await render();
    for (const path of [
      '/fifa.world',
      '/fifa.world/stats',
      '/fifa.world/odds',
      '/eng.1',
      '/eng.1/stats',
      '/eng.1/odds',
      '/nba',
      '/nba/stats',
      '/nba/transactions',
      '/nba/odds',
    ]) {
      expect(body).toContain(`<loc>${SITE_ORIGIN}${path}</loc>`);
    }
  });

  it('omits capability-gated sections that would 307-redirect', async () => {
    const { body } = await render();
    // Only nba has transactions; soccer comps redirect.
    expect(body).not.toContain(`<loc>${SITE_ORIGIN}/fifa.world/transactions</loc>`);
    expect(body).not.toContain(`<loc>${SITE_ORIGIN}/eng.1/transactions</loc>`);
  });

  it('emits only absolute production URLs', async () => {
    const { body } = await render();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) expect(loc.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
  });
});
