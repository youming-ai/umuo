import type { SitemapData } from './data/api';
import { SITE_ORIGIN } from './site';

interface SitemapEntry {
  path: string;
  lastmod?: string;
}

/** Every stable, crawlable path:
 *  - `/` plus one hub per category with published articles (date = newest article)
 *  - `/rss.xml` and `/<category>/rss.xml` — no `lastmod`; a feed is always fresh
 *
 *  Per-link pages are not listed: the site is a link feed and readers go
 *  straight to the source, so hubs are the crawlable surface.
 */
export function sitemapEntries(data: SitemapData): SitemapEntry[] {
  const newest = data.hubs.map((hub) => hub.lastmod).sort();
  const entries: SitemapEntry[] = [
    { path: '/', lastmod: newest[newest.length - 1] },
    { path: '/rss.xml' },
  ];

  for (const hub of data.hubs) {
    entries.push({ path: `/${hub.category}`, lastmod: hub.lastmod });
    entries.push({ path: `/${hub.category}/rss.xml` });
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
