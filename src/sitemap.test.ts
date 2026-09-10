// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SitemapData } from './data/api';
import { renderGoogleNewsSitemap, renderSitemap, sitemapEntries } from './sitemap';
import { SITE_NAME, SITE_ORIGIN } from './site';

// Mirrors what production actually holds: three hubs with content, and
// no /phones, because the sitemap only lists hubs the desk has published in.
const DATA: SitemapData = {
  hubs: [
    { category: 'tools', lastmod: '2026-08-07T09:03:08.000Z' },
    { category: 'design', lastmod: '2026-08-07T09:06:13.000Z' },
    { category: 'development', lastmod: '2026-08-06T13:23:52.000Z' },
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
    expect(paths()).not.toContain('/social');
    expect(paths()).toContain('/tools');
  });

  it('lists a hub only while it has content', () => {
    expect(paths(empty)).not.toContain('/tools');
    expect(paths(empty)).toContain('/');
  });

  it('emits no competition-section paths — the old scoreboard plane is gone', () => {
    for (const path of ['/tools/schedule', '/design/stats', '/design/teams']) {
      expect(paths()).not.toContain(path);
    }
  });

  it('dates each hub by its newest article, and / by the newest of all', () => {
    const entries = sitemapEntries(DATA);
    expect(entries.find((e) => e.path === '/tools')?.lastmod).toBe('2026-08-07T09:03:08.000Z');
    expect(entries.find((e) => e.path === '/')?.lastmod).toBe('2026-08-07T09:06:13.000Z');
  });

  it('emits no duplicate paths', () => {
    const all = paths();
    expect(new Set(all).size).toBe(all.length);
  });

  it('lists the global RSS feed and one per category hub', () => {
    expect(paths()).toContain('/rss.xml');
    expect(paths()).toContain('/tools/rss.xml');
    expect(paths()).toContain('/design/rss.xml');
  });

  it('gives RSS entries no lastmod (feeds are always fresh)', () => {
    const entries = sitemapEntries(DATA);
    expect(entries.find((e) => e.path === '/rss.xml')?.lastmod).toBeUndefined();
    expect(entries.find((e) => e.path === '/tools/rss.xml')?.lastmod).toBeUndefined();
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
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/tools</loc>\n    <lastmod>`);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/design</loc>\n    <lastmod>`);
  });

  it('writes article URLs with lastmod', () => {
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/a/aaa111</loc>\n    <lastmod>`);
  });
});

describe('renderGoogleNewsSitemap', () => {
  const newsArticles = [
    {
      id: 'news-1',
      title: 'Nvidia & AMD launch "confirmed"',
      publishedAt: '2026-08-14T08:00:00.000Z',
    },
  ];

  it('renders valid XML with news namespace and publication data', () => {
    const xml = renderGoogleNewsSitemap(newsArticles);
    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/a/news-1</loc>`);
    expect(xml).toContain(`<news:name>${SITE_NAME}</news:name>`);
    expect(xml).toContain('<news:language>en</news:language>');
    expect(xml).toContain(
      '<news:publication_date>2026-08-14T08:00:00.000Z</news:publication_date>',
    );
    expect(xml).toContain('<news:title>Nvidia &amp; AMD launch &quot;confirmed&quot;</news:title>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});

describe('canonical origin', () => {
  it('points at a host that actually serves the site', () => {
    // Every <loc>, canonical tag and og:url derives from this one constant;
    // public/robots.txt advertises the sitemap on the same host.
    expect(SITE_ORIGIN).toBe('https://umuo.app');
    expect(SITE_ORIGIN.startsWith('https://')).toBe(true);
    expect(SITE_ORIGIN.endsWith('/')).toBe(false);
  });
});
