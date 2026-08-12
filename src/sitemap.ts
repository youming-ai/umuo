import type { SitemapData } from './data/api';
import { SITE_ORIGIN, articlePath } from './site';

export interface SitemapEntry {
  path: string;
  lastmod?: string;
}

/**
 * Every stable, crawlable path:
 *
 * - `/` plus one hub per competition the desk has actually published in, each
 *   carrying the date of its newest article. The competition sections
 *   (schedule/stats/teams/odds/transactions) were removed with the ESPN plane.
 * - `/a/{id}` for each published article — the AI summary page. These give
 *   the AI-generated summaries their own crawlable URLs so search engines
 *   can index the unique content, not just the hub pages.
 * - The RSS feeds live next to their hubs: `/rss.xml` is the global one,
 *   each league also exposes its own `/{comp}/rss.xml` so a reader can
 *   subscribe to just the Premier League desk. No `lastmod` for the RSS
 *   entries — a feed is always fresh and a cached lastmod would mislead
 *   crawlers into thinking the surface is static.
 */
export function sitemapEntries(data: SitemapData): SitemapEntry[] {
  const newest = data.hubs.map((hub) => hub.lastmod).sort();
  const entries: SitemapEntry[] = [
    { path: '/', lastmod: newest[newest.length - 1] },
    { path: '/rss.xml' },
  ];

  for (const hub of data.hubs) {
    entries.push({ path: `/${hub.comp}`, lastmod: hub.lastmod });
    entries.push({ path: `/${hub.comp}/rss.xml` });
  }

  for (const article of data.articles) {
    entries.push({ path: articlePath(article.id), lastmod: article.lastmod });
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
