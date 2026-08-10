// The RSS renderer is a pure function over ExploreFeed. No DB, no env, no
// Worker bindings — these tests run in the default jsdom and execute in
// milliseconds. If the JSON shape ExploreArticle carries ever changes,
// renderExploreRss is the most likely place to feel it first.
import { describe, expect, it } from 'vitest';
import { renderExploreRss } from './rss';
import type { ExploreFeed } from '../types';

function article(
  overrides: Partial<{
    id: string;
    title: string;
    description: string;
    summary: string;
    blurb: string;
    url: string;
    sourceName: string;
    sourceDomain: string;
    publishedAt: number;
    competition: string | null;
    articleType:
      | 'news'
      | 'analysis'
      | 'rumor'
      | 'interview'
      | 'match-report'
      | 'transfer'
      | 'injury'
      | 'video';
    tags: string[];
  }>,
): ExploreFeed['items'][number] {
  return {
    id: 'id-1',
    title: 'Article title',
    description: '',
    summary: '',
    blurb: '',
    url: 'https://bbc.com/sport/article',
    imageUrl: '',
    sourceId: 'bbc-football',
    sourceName: 'BBC Sport Football',
    sourceDomain: 'bbc.com',
    publishedAt: 1735689600000, // 2025-01-01T00:00:00Z (a fixed instant so the test is stable)
    competition: 'eng.1',
    articleType: 'match-report',
    tags: ['premier-league'],
    qualityScore: 80,
    freshnessScore: 70,
    ...overrides,
  };
}

describe('renderExploreRss', () => {
  it('starts with an XML declaration line, then the rss root', () => {
    const xml = renderExploreRss({ items: [], nextCursor: null }, 'All football');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<title>umuo \u2014 AI football news</title>');
    expect(xml).toContain('<description>AI-curated football news');
    expect(xml).toContain('<language>en-us</language>');
    expect(xml).toContain('<generator>umuo</generator>');
  });

  it('scopes the channel title to a competition when one is provided', () => {
    const xml = renderExploreRss({ items: [], nextCursor: null }, 'Premier League');
    expect(xml).toContain('<title>umuo \u2014 Premier League football news</title>');
  });

  it('emits one <item> per article with stable guid, RFC 822 date, and categories', () => {
    const xml = renderExploreRss(
      {
        items: [
          article({
            id: 'stable-fingerprint',
            title: 'A late winner at the Emirates',
            summary: 'A late winner at the Emirates.',
            sourceDomain: 'bbc.com',
          }),
        ],
        nextCursor: null,
      },
      'All football',
    );
    expect(xml).toContain('<item>');
    expect(xml).toContain('<title>A late winner at the Emirates</title>');
    expect(xml).toContain('<guid isPermaLink="false">stable-fingerprint</guid>');
    // RFC 822: month + day + year + time + GMT
    expect(xml).toMatch(
      /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/,
    );
    expect(xml).toContain('<category>competition:eng.1</category>');
    expect(xml).toContain('<category>type:match-report</category>');
    expect(xml).toContain('<category>source:bbc.com</category>');
    expect(xml).toContain('<category>tag:premier-league</category>');
  });

  it('escapes XML special characters in title, blurb, and tag', () => {
    const xml = renderExploreRss(
      {
        items: [
          article({
            title: 'Arsenal "win" <3> & forget the rest',
            summary: 'They said "lucky" & left.',
            tags: ['quotes & brackets'],
          }),
        ],
        nextCursor: null,
      },
      'All football',
    );
    expect(xml).toContain('Arsenal &quot;win&quot; &lt;3&gt; &amp; forget the rest');
    expect(xml).toContain('They said &quot;lucky&quot; &amp; left.');
    expect(xml).toContain('tag:quotes &amp; brackets');
    // The original characters must not survive into XML as raw bytes.
    expect(xml).not.toContain('"win"');
    expect(xml).not.toContain('<3>');
  });

  it('falls back through summary → blurb → description for the item description', () => {
    // The channel itself always has a <description>, so we scope the empty-
    // body assertion to the lone <item>'s content.
    const itemsOnly = (xml: string): string => {
      const start = xml.indexOf('<item>');
      const end = xml.lastIndexOf('</item>');
      return start >= 0 && end >= 0 ? xml.slice(start, end + '</item>'.length) : '';
    };

    const fromBlurb = renderExploreRss(
      { items: [article({ summary: '', blurb: 'from blurb' })], nextCursor: null },
      'All football',
    );
    expect(itemsOnly(fromBlurb)).toContain('<description>from blurb</description>');

    const fromDescription = renderExploreRss(
      {
        items: [article({ summary: '', blurb: '', description: 'publisher copy' })],
        nextCursor: null,
      },
      'All football',
    );
    expect(itemsOnly(fromDescription)).toContain('<description>publisher copy</description>');

    const empty = renderExploreRss(
      { items: [article({ summary: '', blurb: '', description: '' })], nextCursor: null },
      'All football',
    );
    expect(itemsOnly(empty)).not.toContain('<description>');
  });

  it('caps the rendered feed at 50 items even when the underlying feed is larger', () => {
    const items = Array.from({ length: 120 }, (_, i) => article({ id: `id-${i}` }));
    const xml = renderExploreRss({ items, nextCursor: null }, 'All football');
    expect(xml.match(/<item>/g)).toHaveLength(50);
    expect(xml).toContain('<guid isPermaLink="false">id-49</guid>');
    expect(xml).not.toContain('<guid isPermaLink="false">id-50</guid>');
  });

  it('renders an Atom self link when given one', () => {
    const xml = renderExploreRss({ items: [], nextCursor: null }, 'All football', {
      includeAtomSelfLink: '/rss.xml',
    });
    expect(xml).toContain('<atom:link href="/rss.xml" rel="self" type="application/rss+xml" />');
  });

  it('points the channel link to a per-competition hub when one is supplied', () => {
    const xml = renderExploreRss({ items: [], nextCursor: null }, 'Premier League', {
      channelLink: 'https://umuo.app/eng.1',
    });
    expect(xml).toContain('<link>https://umuo.app/eng.1</link>');
    expect(xml).not.toContain('<link>https://umuo.app/</link>');
  });

  it('falls back to the global origin when no channel link is supplied', () => {
    const xml = renderExploreRss({ items: [], nextCursor: null }, 'All football');
    expect(xml).toContain('<link>https://umuo.app/</link>');
  });
});
