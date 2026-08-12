// Canonical production origin. Single source of truth for absolute URLs
// (canonical/og tags in Layout.astro, <loc> entries in sitemap.xml) so the
// two never drift. Pure string — compiles under both tsconfigs.
//
// This said cup.umuo.app until 2026-08-07. That host is NXDOMAIN — the site is
// served from umuo.app — so every canonical tag, og:url, og:image and sitemap
// <loc> pointed at a domain that does not resolve.
export const SITE_ORIGIN = 'https://umuo.app';

/**
 * Path prefix for AI-generated article summary pages. Single source of truth
 * so the route, the sitemap, the card links and the IndexNow pinger never
 * drift apart.
 */
export function articlePath(id: string): string {
  return `/a/${id}`;
}
