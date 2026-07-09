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

  // Assets + API + known unprefixed routes pass through.
  if (
    path.startsWith('/api/') ||
    path.startsWith('/news') ||
    path === '/favicon.png' ||
    path === '/apple-touch-icon.png' ||
    path === '/icon-192.png' ||
    path === '/icon-512.png' ||
    path === '/manifest.webmanifest' ||
    path === '/sw.js' ||
    path === '/logo-full.png' ||
    path === '/og.jpg'
  ) {
    return next();
  }

  // Known competition prefixes pass through.
  for (const key of Object.keys(COMPETITIONS)) {
    if (path === `/${key}` || path.startsWith(`/${key}/`)) {
      return next();
    }
  }

  // Root redirect — news-first home.
  if (path === '/') {
    return context.redirect('/news', 307);
  }

  // Legacy unprefixed paths: redirect to the default competition.
  // /scorers → /fifa.world/scorers, /match/foo → /fifa.world/match/foo, etc.
  return context.redirect(`/${DEFAULT_COMPETITION}${path}`, 307);
}
