import { describe, expect, it } from 'vitest';
import { parseRss } from './rss';
import type { FeedSource } from './types';

const source: FeedSource = {
  id: 'test-football',
  kind: 'rss',
  name: 'Test Football',
  url: 'https://example.com/rss.xml',
  sport: 'soccer',
  authorityScore: 80,
  defaultEnabled: true,
};

describe('parseRss', () => {
  it('normalizes RSS/Atom fields and strips markup', () => {
    const articles = parseRss(
      `<rss><channel><item>
        <title><![CDATA[Club &amp; manager update]]></title>
        <link>https://example.com/story?utm_source=test</link>
        <description><![CDATA[<p>A short <b>football</b> report.</p>]]></description>
        <pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate>
        <media:content url="https://example.com/image.jpg" width="800" height="600" />
      </item></channel></rss>`,
      source,
      Date.parse('2026-08-05T12:00:00Z'),
    );

    expect(articles).toEqual([
      expect.objectContaining({
        title: 'Club & manager update',
        description: 'A short football report.',
        url: 'https://example.com/story?utm_source=test',
        imageUrl: 'https://example.com/image.jpg',
        imageWidth: 800,
        imageHeight: 600,
        publishedAt: Date.parse('2026-08-05T10:00:00Z'),
      }),
    ]);
  });
});
