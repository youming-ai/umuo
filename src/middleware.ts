import { COMPETITIONS, DEFAULT_COMPETITION } from './competitions';

// Astro middleware: runs on every request (SSR and static). Redirects the
// root and legacy unprefixed paths to their canonical forms under the
// default competition. Known routes (comp prefixes, /api) and asset-like paths
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
  if (path === '/api' || path.startsWith('/api/') || lastSeg.includes('.')) {
    return next();
  }

  // Legacy /scorers slug → /stats (the page now renders season stat
  // leaderboards). Redirect the unprefixed legacy form and comp-scoped
  // /<comp>/scorers for KNOWN competitions only — an unknown /foo/scorers or
  // /news/scorers falls through to the legacy/news handlers below instead of
  // being masked into a non-existent /foo/stats.
  if (path === '/scorers') return context.redirect(`/${DEFAULT_COMPETITION}/stats${search}`, 307);
  const slash = path.indexOf('/', 1);
  if (slash !== -1) {
    const comp = path.slice(1, slash);
    if (Object.hasOwn(COMPETITIONS, comp) && path === `/${comp}/scorers`)
      return context.redirect(`/${comp}/stats${search}`, 307);
  }

  // Known competition prefixes pass through.
  for (const key of Object.keys(COMPETITIONS)) {
    if (path === `/${key}` || path.startsWith(`/${key}/`)) {
      return next();
    }
  }

  // Root redirect — the default competition's news page. Preserve the query
  // string on every redirect so share/UTM params survive the hop.
  if (path === '/') {
    return context.redirect(`/${DEFAULT_COMPETITION}/news${search}`, 307);
  }

  // Legacy global news (removed) → the default competition's news page, so old
  // /news, /news/soccer, /news/league/* links land on a real 200 in one hop.
  if (path === '/news' || path.startsWith('/news/')) {
    return context.redirect(`/${DEFAULT_COMPETITION}/news${search}`, 307);
  }

  // Legacy unprefixed paths: redirect to the default competition.
  // /scorers → /fifa.world/scorers, /match/foo → /fifa.world/match/foo, etc.
  return context.redirect(`/${DEFAULT_COMPETITION}${path}${search}`, 307);
}
