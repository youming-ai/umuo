// RSS 2.0 renderer for the AI-curated Explore feed. Pure: takes an
// `ExploreFeed` + scope label and emits a channel XML document. No DOM,
// no D1, no Worker bindings — testable in isolation and importable by
// both the API handler and the SSR pages.
import { SITE_ORIGIN } from '../site';
import type { ExploreArticle, ExploreFeed } from '../types';

const RSS_XMLNS = 'http://www.w3.org/2005/Atom';

// Every feed needs a unique string id. The channel uses the origin itself
// (a stable value the reader stores once); items use the article's `id`
// (the AI fingerprint — stable across rebuilds) so deletes/sweeps don't
// shift the guid and force a re-download.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// RFC 822 with explicit `GMT` — readers that ignore `<pubDate>` quietly are
// rare but real, and an omit-zone date string fails to parse elsewhere. The
// AI stable ms value goes to the second, no ms — that is what news readers
// actually compare against.
function rfc822(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp).toUTCString();
}

// `<category>` per assignment kept human-readable: "competition:eng.1" beats
// a bare slug, and readers (NetNewsWire, Feedbin, Reeder) sort them as tags.
function categoriesFor(article: ExploreArticle): string[] {
  const categories: string[] = [];
  if (article.competition) categories.push(`competition:${article.competition}`);
  if (article.articleType) categories.push(`type:${article.articleType}`);
  if (article.sourceDomain) categories.push(`source:${article.sourceDomain}`);
  for (const tag of article.tags.slice(0, 8)) categories.push(`tag:${tag}`);
  return categories;
}

// Description is the AI blurb (the editorial 1–2 sentence summary); if the
// model hadn't pushed one through we fall back to the publisher description.
// Both paths are plain-text in D1 today, so XML-escaping is sufficient — no
// CDATA needed, no HTML stripping, reader will render them as text.
function descriptionFor(article: ExploreArticle): string {
  return article.summary || article.blurb || article.description || '';
}

function renderItem(article: ExploreArticle): string {
  const parts = [
    '    <item>',
    `      <title>${escapeXml(article.title)}</title>`,
    `      <link>${escapeXml(article.url)}</link>`,
    // guid isPermaLink=false: the article *id* (AI fingerprint) is the stable
    // identity, not the publisher URL — publishers move / 301 that link all
    // the time, and the canonical_url normaliser has already collapsed the
    // tracking junk.
    `      <guid isPermaLink="false">${escapeXml(article.id)}</guid>`,
    `      <pubDate>${rfc822(article.publishedAt)}</pubDate>`,
  ];
  const description = descriptionFor(article);
  if (description) parts.push(`      <description>${escapeXml(description)}</description>`);
  const author = article.sourceName || article.sourceDomain;
  if (author)
    parts.push(`      <author>noreply@${escapeXml(article.sourceDomain || 'umuo.app')}</author>`);
  for (const category of categoriesFor(article)) {
    parts.push(`      <category>${escapeXml(category)}</category>`);
  }
  parts.push('    </item>');
  return parts.join('\n');
}

/**
 * Render an `ExploreFeed` as an RSS 2.0 document. The 50-item slice mirrors
 * the same cap used at the JSON endpoint: it keeps one reader-poll bounded
 * without losing anything — beyond today's top 50 the signal is noise.
 *
 * `channelLink` lets the per-competition feed jump the reader into the
 * right hub (`/eng.1`) rather than the global home — clicking a PL story
 * out of NetNewsWire shouldn't land on a Bundesliga story.
 */
export function renderExploreRss(
  feed: ExploreFeed,
  scopeLabel: string,
  options: { includeAtomSelfLink?: string; channelLink?: string } = {},
): string {
  const channelTitle =
    scopeLabel === 'All football'
      ? 'umuo — AI football news'
      : `umuo — ${scopeLabel} football news`;
  const channelLink = options.channelLink ?? `${SITE_ORIGIN}/`;
  const channelDescription =
    'AI-curated football news from 20 trusted publishers, refreshed every 15 minutes.';
  const published = new Date().toUTCString();
  const items = feed.items.slice(0, 50).map(renderItem).join('\n');
  const atomLink = options.includeAtomSelfLink
    ? `\n    <atom:link href="${escapeXml(options.includeAtomSelfLink)}" rel="self" type="application/rss+xml" />`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="${RSS_XMLNS}">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(channelDescription)}</description>
    <language>en-us</language>
    <lastBuildDate>${published}</lastBuildDate>
    <generator>umuo</generator>${atomLink}
${items}
  </channel>
</rss>
`;
}
