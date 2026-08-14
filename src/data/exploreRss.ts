// RSS 2.0 renderer for the Explore feed. Pure: no DOM, no D1, no Worker
// bindings — importable by both the API handler and the SSR pages.
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, SITE_TITLE } from '../site';
import type { ExploreArticle, ExploreFeed } from '../types';
import { escapeXml } from '../utils/xml';

// Bound to the `atom:` prefix; the only Atom element is <atom:link rel="self">.
const ATOM_XMLNS = 'http://www.w3.org/2005/Atom';

// Channel uses the origin; items use the article's `id` so deletes/sweeps

// RFC 822 with explicit `GMT` — some readers ignore <pubDate> quietly, and an
// omit-zone date string fails to parse elsewhere.
function rfc822(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp).toUTCString();
}

function categoriesFor(article: ExploreArticle): string[] {
  const categories: string[] = [];
  if (article.competition) categories.push(`competition:${article.competition}`);
  if (article.articleType) categories.push(`type:${article.articleType}`);
  if (article.sourceDomain) categories.push(`source:${article.sourceDomain}`);
  for (const tag of article.tags.slice(0, 8)) categories.push(`tag:${tag}`);
  return categories;
}

// Prefer the AI blurb, fall back to the publisher description. Both are
// plain-text in D1, so XML-escaping is sufficient.
function descriptionFor(article: ExploreArticle): string {
  return article.summary || article.blurb || article.description || '';
}

function renderItem(article: ExploreArticle): string {
  const parts = [
    '    <item>',
    `      <title>${escapeXml(article.title)}</title>`,
    `      <link>${escapeXml(article.url)}</link>`,
    // isPermaLink=false: the article *id* (AI fingerprint) is the stable
    // identity, not the publisher URL.
    `      <guid isPermaLink="false">${escapeXml(article.id)}</guid>`,
    `      <pubDate>${rfc822(article.publishedAt)}</pubDate>`,
  ];
  const description = descriptionFor(article);
  if (description) parts.push(`      <description>${escapeXml(description)}</description>`);
  // <author> is specified as an email address; the publisher's domain is all
  // we can honestly put in it.
  parts.push(`      <author>noreply@${escapeXml(article.sourceDomain || 'umuo.app')}</author>`);
  for (const category of categoriesFor(article)) {
    parts.push(`      <category>${escapeXml(category)}</category>`);
  }
  parts.push('    </item>');
  return parts.join('\n');
}

/** Render an `ExploreFeed` as an RSS 2.0 document. `channelLink` lets the
 *  per-competition feed jump a reader into the matching hub. */
export function renderExploreRss(
  feed: ExploreFeed,
  scopeLabel: string,
  options: { includeAtomSelfLink?: string; channelLink?: string } = {},
): string {
  const channelTitle =
    scopeLabel === 'All football' ? SITE_TITLE : `${SITE_NAME} — ${scopeLabel} football news`;
  const channelLink = options.channelLink ?? `${SITE_ORIGIN}/`;
  const channelDescription = SITE_DESCRIPTION;
  const published = new Date().toUTCString();
  const items = feed.items.map(renderItem).join('\n');
  const atomLink = options.includeAtomSelfLink
    ? `\n    <atom:link href="${escapeXml(options.includeAtomSelfLink)}" rel="self" type="application/rss+xml" />`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="${ATOM_XMLNS}">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(channelDescription)}</description>
    <language>en-us</language>
    <lastBuildDate>${published}</lastBuildDate>
    <generator>${SITE_NAME}</generator>${atomLink}
${items}
  </channel>
</rss>
`;
}
