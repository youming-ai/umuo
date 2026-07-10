import { COMPETITIONS, DEFAULT_COMPETITION } from './competitions';

// Astro middleware: runs on every request (SSR and static). Redirects the
// root and legacy unprefixed paths to their canonical forms under the
// default competition. Known routes (with comp prefixes, /api, /news)
// pass through unchanged.
export function onRequest(
  context: { request: Request; redirect: (url: string, status?: number) => Response; url: URL },
  next: () => Response | Promise<Response>,
) {
  const path = context.url.pathname;
  const search = context.url.search;
  // A dot in the final segment means a static asset (favicon.png, sw.js,
  // manifest.webmanifest, og.jpg, …) or any file-like path — pass it through so
  // a missing file 404s cleanly instead of being redirected into a comp path.
  const lastSeg = path.slice(path.lastIndexOf('/') + 1);

  // Assets + API + known unprefixed routes pass through.
  if (
    path === '/api' ||
    path.startsWith('/api/') ||
    path === '/news' ||
    path.startsWith('/news/') ||
    lastSeg.includes('.')
  ) {
    return next();
  }

  // Known competition prefixes pass through.
  for (const key of Object.keys(COMPETITIONS)) {
    if (path === `/${key}` || path.startsWith(`/${key}/`)) {
      return next();
    }
  }

  // Root redirect — news-first home. Preserve the query string on every
  // redirect so share/UTM params survive the hop.
  if (path === '/') {
    return context.redirect(`/news${search}`, 307);
  }

  // Legacy unprefixed paths: redirect to the default competition.
  // /scorers → /fifa.world/scorers, /match/foo → /fifa.world/match/foo, etc.
  return context.redirect(`/${DEFAULT_COMPETITION}${path}${search}`, 307);
}
