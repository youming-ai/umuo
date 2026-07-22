import { COMPETITIONS, DEFAULT_COMPETITION } from './competitions';

// Astro middleware: runs on every request (SSR and static). The global home
// (/), known routes (comp prefixes, /api), and asset-like paths pass through
// unchanged. Removed/legacy paths 307 to their new homes (retired World Cup →
// /, /<comp>/news|bracket → /<comp>, legacy /news → default-comp hub).
export function onRequest(
  context: { request: Request; redirect: (url: string, status?: number) => Response; url: URL },
  next: () => Response | Promise<Response>,
) {
  // Normalise a trailing slash (except root) so legacy bookmarks/crawler URLs
  // like /<comp>/news/ or /<comp>/bracket/ hit the same redirects as their
  // slashless form instead of falling through to a deleted Astro route (404).
  const rawPath = context.url.pathname;
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  const search = context.url.search;
  // A dot in the final segment means a static asset (favicon.png, sw.js,
  // manifest.webmanifest, og.jpg, …) or any file-like path — pass it through so
  // a missing file 404s cleanly instead of being redirected into a comp path.
  const lastSeg = path.slice(path.lastIndexOf('/') + 1);

  // The global home renders at / (no more root → default-competition hop).
  if (path === '/') {
    return next();
  }

  // World Cup retired (2026-07) — its old paths 307 to the global home. Runs
  // before the asset guard so the bare /fifa.world (dot in last segment) is
  // caught too, not mistaken for a file.
  if (path === '/fifa.world' || path.startsWith('/fifa.world/'))
    return context.redirect(`/${search}`, 307);

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

  // Known competition prefixes pass through, but collapse removed sub-routes:
  // /<comp>/news (now the hub) and /<comp>/bracket (feature removed) → /<comp>.
  for (const key of Object.keys(COMPETITIONS)) {
    if (path === `/${key}` || path.startsWith(`/${key}/`)) {
      if (path === `/${key}/news` || path === `/${key}/bracket`)
        return context.redirect(`/${key}${search}`, 307);
      return next();
    }
  }

  // Legacy global news and bracket (removed) → default competition's hub in 1 hop.
  if (
    path === '/news' ||
    path.startsWith('/news/') ||
    path === '/bracket' ||
    path.startsWith('/bracket/')
  ) {
    return context.redirect(`/${DEFAULT_COMPETITION}${search}`, 307);
  }

  // Legacy unprefixed paths: redirect to the default competition.
  // /scorers → /eng.1/scorers, /match/foo → /eng.1/match/foo, etc.
  return context.redirect(`/${DEFAULT_COMPETITION}${path}${search}`, 307);
}
