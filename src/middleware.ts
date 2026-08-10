// Astro middleware: runs on every request (SSR and static). The old
// competition-plane redirects (fifa.world, /<comp>/news|bracket, /scorers,
// legacy unprefixed paths) went away with the ESPN pages; only the Explore
// surface's legacy URL survives. Asset-like paths and /api pass through so a
// missing file 404s cleanly instead of being redirected into a comp path.

export function onRequest(
  context: { request: Request; redirect: (url: string, status?: number) => Response; url: URL },
  next: () => Response | Promise<Response>,
) {
  const path = context.url.pathname.replace(/\/+$/, '') || '/';

  // The Explore surface now lives at /. Keep the old URL as a permanent
  // redirect so bookmarks and crawlers converge on the canonical homepage.
  if (path === '/explore') return context.redirect(`/${context.url.search}`, 308);

  return next();
}
