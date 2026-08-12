import type { SitemapData } from './data/api';
import { SITE_ORIGIN, articlePath } from './site';

export interface SitemapEntry {
  path: string;
  lastmod?: string;
}

/** Every stable, crawlable path:
 *  - `/` plus one hub per competition with published articles (date = newest article)
 *  - `/a/{id}` for each published article — gives each AI summary a crawlable URL
 *  - `/rss.xml` and `/<comp>/rss.xml` — no `lastmod`; a feed is always fresh
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
