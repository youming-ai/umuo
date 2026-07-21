import type { APIRoute } from 'astro';
import { COMPETITIONS } from '../competitions';
import { SITE_ORIGIN } from '../site';

export const prerender = false;

// SSR sitemap of the stable, crawlable pages. We list only routes that return
// 200 directly — no redirects (the `/` → default-competition home hop, or capability
// deep-links like eng.1/nba `/scorers` that 307 back to `/${comp}/stats`), which
// search engines flag as "Page with redirect" and drop. Dynamic detail pages
// (match/team/player) are intentionally omitted: they churn with live ESPN
// data, are enumerable only by hitting upstream, and go stale/404 fast — the
// core pages below give crawlers the entry points to reach them via in-page links.
export const GET: APIRoute = () => {
  const paths: string[] = [];

  // Per-competition pages, derived from the registry and gated on capabilities
  // so we never emit a section that redirects (scorers 307 when off).
  for (const c of Object.values(COMPETITIONS)) {
    paths.push(`/${c.key}`);
    paths.push(`/${c.key}/news`);
    paths.push(`/${c.key}/teams`);
    if (c.capabilities.scorers) paths.push(`/${c.key}/stats`);
    if (c.capabilities.transactions) paths.push(`/${c.key}/transactions`);
    if (c.capabilities.odds) paths.push(`/${c.key}/odds`);
  }

  const urls = paths.map((p) => `  <url>\n    <loc>${SITE_ORIGIN}${p}</loc>\n  </url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
