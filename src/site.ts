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

// Ad redirect URL — opened as pop-under on the detail page's original story action.
// ponytail: single hardcoded ad endpoint; move to a registry/rotation if we
// ever run more than one network.
export const AD_CLICK_URL =
  'https://conductivebreeds.com/idx9adfk?key=2b7f1e2f290269d8b20a6fcb0a4b3d00';

/** Path prefix for AI-generated article summary pages. Single source of truth
 *  so the route, the sitemap, and the card links stay in sync. */
export function articlePath(id: string): string {
  return `/a/${id}`;
}

export function imgProxyUrl(src: string): string {
  if (!src) return src;
  return src.replace('ichef.bbci.co.uk/ace/standard/240/', 'ichef.bbci.co.uk/ace/standard/1024/');
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
