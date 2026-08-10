import type { SitemapNewsHub } from './data/api';
import { SITE_ORIGIN } from './site';

export interface SitemapEntry {
  path: string;
  lastmod?: string;
}

/**
 * Every stable, crawlable path. The news surface is content-driven: `/` plus
 * one hub per competition the desk has actually published in, each carrying
 * the date of its newest article. The competition sections (schedule/stats/
 * teams/odds/transactions) were removed with the ESPN plane.
 */
export function sitemapEntries(news: SitemapNewsHub[]): SitemapEntry[] {
  const newest = news.map((hub) => hub.lastmod).sort();
  const entries: SitemapEntry[] = [{ path: '/', lastmod: newest[newest.length - 1] }];

  for (const hub of news) {
    entries.push({ path: `/${hub.comp}`, lastmod: hub.lastmod });
  }

  return entries;
}

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(({ path, lastmod }) =>
      [
        '  <url>',
        `    <loc>${SITE_ORIGIN}${path}</loc>`,
        ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
        '  </url>',
      ].join('\n'),
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
