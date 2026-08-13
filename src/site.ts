// Canonical production origin. Single source of truth for absolute URLs
// (canonical/og tags, sitemap <loc>). Pure string — compiles under both
// tsconfigs.
export const SITE_ORIGIN = 'https://umuo.app';

// Brand-facing copy. Single source of truth: the layout <title>/description
// defaults and the RSS channel description import from here, so a rebrand
// or positioning change edits one file, not three.
export const SITE_NAME = 'umuo';
export const SITE_TITLE = 'umuo — AI football news';
export const SITE_DESCRIPTION =
  'AI-curated football news from trusted sources, organized by competition and topic.';
export const SITE_LOCALE = 'en_US';
export const SITE_LANGUAGE = 'en';

/** Path prefix for AI-generated article summary pages. Single source of truth
 *  so the route, the sitemap, the card links, and the IndexNow pinger stay in
 *  sync. */
export function articlePath(id: string): string {
  return `/a/${id}`;
}

/** Route a source image through the Worker image proxy (/api/img) so it is
 *  edge-resized (Cloudflare Image Resizing) to the display width instead of
 *  shipping a multi-megapixel original. Same string on server and client. */
export function imgProxyUrl(src: string, width = 800): string {
  if (!src) return src;
  return `/api/img?src=${encodeURIComponent(src)}&w=${width}`;
}
