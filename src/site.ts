// Canonical production origin. Single source of truth for absolute URLs
// (canonical/og tags in Layout.astro, <loc> entries in sitemap.xml) so the
// two never drift. Pure string — compiles under both tsconfigs.
export const SITE_ORIGIN = 'https://cup.umuo.app';
