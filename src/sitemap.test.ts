// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SitemapData } from './data/api';
import { renderSitemap, sitemapEntries } from './sitemap';
import { SITE_ORIGIN } from './site';

// Mirrors what production actually holds: six football hubs with content, and
// no nba hub, because the desk is football-only.
const DATA: SitemapData = {
  hubs: [
    { comp: 'eng.1', lastmod: '2026-08-07T09:03:08.000Z' },
    { comp: 'esp.1', lastmod: '2026-08-07T09:06:13.000Z' },
    { comp: 'uefa.champions', lastmod: '2026-08-06T13:23:52.000Z' },
  ],
  articles: [
    { id: 'aaa111', lastmod: '2026-08-07T09:03:08.000Z' },
    { id: 'bbb222', lastmod: '2026-08-06T13:23:52.000Z' },
  ],
};

const empty: SitemapData = { hubs: [], articles: [] };

const paths = (data: SitemapData = DATA) => sitemapEntries(data).map((e) => e.path);

describe('sitemapEntries', () => {
  it('never lists a news hub the desk has not published in', () => {
    // The bug this replaces: the hub list came from COMPETITIONS, so /nba was
    // advertised while src/pages/[comp]/index.astro answered it with a 404.
    expect(paths()).not.toContain('/nba');
    expect(paths()).toContain('/eng.1');
  });

  it('lists a hub only while it has content', () => {
    expect(paths(empty)).not.toContain('/eng.1');
    expect(paths(empty)).toContain('/');
  });

  it('emits no competition-section paths — the ESPN plane is gone', () => {
    for (const path of ['/nba/schedule', '/eng.1/stats', '/eng.1/teams']) {
      expect(paths()).not.toContain(path);
    }
  });

  it('dates each hub by its newest article, and / by the newest of all', () => {
    const entries = sitemapEntries(DATA);
    expect(entries.find((e) => e.path === '/eng.1')?.lastmod).toBe('2026-08-07T09:03:08.000Z');
    expect(entries.find((e) => e.path === '/')?.lastmod).toBe('2026-08-07T09:06:13.000Z');
  });

  it('emits no duplicate paths', () => {
    const all = paths();
    expect(new Set(all).size).toBe(all.length);
  });

  it('lists the global RSS feed and one per competition hub', () => {
    expect(paths()).toContain('/rss.xml');
    expect(paths()).toContain('/eng.1/rss.xml');
    expect(paths()).toContain('/uefa.champions/rss.xml');
  });

  it('gives RSS entries no lastmod (feeds are always fresh)', () => {
    const entries = sitemapEntries(DATA);
    expect(entries.find((e) => e.path === '/rss.xml')?.lastmod).toBeUndefined();
    expect(entries.find((e) => e.path === '/eng.1/rss.xml')?.lastmod).toBeUndefined();
  });

  it('lists each article at /a/{id} with its published date as lastmod', () => {
    const entries = sitemapEntries(DATA);
    expect(entries.find((e) => e.path === '/a/aaa111')?.lastmod).toBe('2026-08-07T09:03:08.000Z');
    expect(entries.find((e) => e.path === '/a/bbb222')?.lastmod).toBe('2026-08-06T13:23:52.000Z');
  });

  it('emits no article paths when there are none', () => {
    const noArticles = sitemapEntries({ hubs: DATA.hubs, articles: [] });
    expect(noArticles.every((e) => !e.path.startsWith('/a/'))).toBe(true);
  });
});

describe('renderSitemap', () => {
  const xml = renderSitemap(sitemapEntries(DATA));

  it('is valid XML in the sitemap namespace', () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('emits only absolute production URLs', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) expect(loc.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
  });

  it('writes lastmod only where there is one', () => {
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/eng.1</loc>\n    <lastmod>`);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/uefa.champions</loc>\n    <lastmod>`);
  });

  it('writes article URLs with lastmod', () => {
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/a/aaa111</loc>\n    <lastmod>`);
  });
});

describe('canonical origin', () => {
  it('points at a host that actually serves the site', () => {
    // Every <loc>, canonical tag and og:url derives from this one constant. It
    // read cup.umuo.app for months, which is NXDOMAIN, so search engines were
    // told the canonical copy of every page lived somewhere unreachable.
    expect(SITE_ORIGIN).toBe('https://umuo.app');
    expect(SITE_ORIGIN.startsWith('https://')).toBe(true);
    expect(SITE_ORIGIN.endsWith('/')).toBe(false);
  });
});
