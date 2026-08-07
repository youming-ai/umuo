import { COMPETITIONS } from './competitions';
import type { SitemapNewsHub } from './data/api';
import { SECTIONS } from './sections';
import { SITE_ORIGIN } from './site';
import { pathFor } from './utils/router';

export interface SitemapEntry {
  path: string;
  lastmod?: string;
}

/**
 * Every stable, crawlable path, in two parts.
 *
 * The news surface is content-driven: `/` plus one hub per competition the desk
 * has actually published in, each carrying the date of its newest article. It
 * used to come from the SECTIONS table crossed with COMPETITIONS, which emitted
 * `/nba` — a hub src/pages/[comp]/index.astro answers with a 404, because the
 * desk is football-only. A sitemap that advertises a 404 is worse than one that
 * omits the page.
 *
 * The competition sections are still registry-driven. They read ESPN, not D1,
 * so there is nothing to date them by, and they exist for every competition
 * including the basketball one.
 *
 * Detail pages (match/team/player) stay out on purpose: they churn with live
 * upstream data, are enumerable only by hitting ESPN, and go stale fast. The
 * pages below give crawlers the entry points to reach them by following links.
 */
export function sitemapEntries(news: SitemapNewsHub[]): SitemapEntry[] {
  const newest = news.map((hub) => hub.lastmod).sort();
  const entries: SitemapEntry[] = [{ path: '/', lastmod: newest[newest.length - 1] }];

  for (const hub of news) {
    entries.push({
      path: pathFor({ kind: 'section', comp: hub.comp, section: 'news' }),
      lastmod: hub.lastmod,
    });
  }

  for (const competition of Object.values(COMPETITIONS)) {
    for (const section of SECTIONS) {
      // The news hub is the one section that comes from D1 above.
      if (section.section === 'news') continue;
      // Capability-gated sections 307 to /<comp>/stats, and search engines drop
      // anything they reach through a redirect.
      if (section.capability && !competition.capabilities[section.capability]) continue;
      entries.push({
        path: pathFor({ kind: 'section', comp: competition.key, section: section.section }),
      });
    }
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
