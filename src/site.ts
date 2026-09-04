// Canonical production origin. Single source of truth for absolute URLs
// (canonical/og tags, sitemap <loc>). Pure string — compiles under both
// tsconfigs. TODO(template): replace with your domain.
export const SITE_ORIGIN = 'https://umuo.app';

// Brand-facing copy. Single source of truth: the layout <title>/description
// defaults and the RSS channel description import from here, so a rebrand
// or positioning change edits one file, not three.
// TODO(template): replace with your brand.
export const SITE_NAME = 'umuo';
export const SITE_TITLE = 'umuo — AI-curated tech news';
export const SITE_DESCRIPTION =
  'AI-curated technology news — AI, consumer electronics, and PC hardware — from trusted sources, organized by category and source.';

/** Scope label for the global (uncategorised) feed: the rail's All row, the
 *  RSS channel-title marker, and the article page's back link. Single source
 *  of truth so the marker comparison in exploreRss.ts can't drift. */
export const GLOBAL_FEED_LABEL = 'All tech';
export const SITE_LOCALE = 'en_US';
export const SITE_LANGUAGE = 'en';

/** Path prefix for AI-generated article summary pages. Single source of truth
 *  so the route, the sitemap, and the card links stay in sync. */
export function articlePath(id: string): string {
  return `/a/${id}`;
}

/** Single source of truth for article description fallback policies:
 *  - 'short': blurb-first for card stream & previews (concise teaser)
 *  - 'long': summary-first for article detail page & RSS (in-depth analysis) */
export function articleDeck(
  article: { summary?: string; blurb?: string; description?: string },
  mode: 'short' | 'long' = 'short',
): string {
  if (mode === 'short') {
    return article.blurb || article.summary || article.description || '';
  }
  return article.summary || article.blurb || article.description || '';
}
