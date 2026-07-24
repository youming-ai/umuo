import type { APIRoute } from 'astro';
import { COMPETITIONS } from '../competitions';
import { SECTIONS } from '../sections';
import { SITE_ORIGIN } from '../site';
import { pathFor } from '../utils/router';

export const prerender = false;

// SSR sitemap of the stable, crawlable pages. We list only routes that return
// 200 directly — no redirects (the `/` → default-competition home hop, or capability
// deep-links like eng.1/nba `/scorers` that 307 back to `/${comp}/stats`), which
// search engines flag as "Page with redirect" and drop. Dynamic detail pages
// (match/team/player) are intentionally omitted: they churn with live ESPN
// data, are enumerable only by hitting upstream, and go stale/404 fast — the
// core pages below give crawlers the entry points to reach them via in-page links.
export const GET: APIRoute = () => {
  const paths: string[] = ['/']; // global home — returns 200, no redirect

  // Per-competition pages, derived from the one SECTIONS table and gated on
  // capabilities so we never emit a section that redirects (scorers 307 when off).
  for (const c of Object.values(COMPETITIONS)) {
    for (const s of SECTIONS) {
      if (s.capability && !c.capabilities[s.capability]) continue;
      paths.push(pathFor({ kind: 'section', comp: c.key, section: s.section }));
    }
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
