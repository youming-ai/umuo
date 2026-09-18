import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../data/api';
import { canonicalizeUrl, ingestAllSources, knownCanonicalUrls, knownFingerprints } from './ingest';

describe('canonicalizeUrl', () => {
  it('removes tracking parameters while preserving editorial query parameters', () => {
    expect(
      canonicalizeUrl('HTTPS://WWW.Example.com/story/?utm_source=feed&FBCLID=abc&page=2#comments'),
    ).toBe('https://www.example.com/story?page=2');
  });

  it('returns non-URL input without throwing', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });

  it('drops any scheme that is not http(s)', () => {
    // `new URL('javascript:alert(1)')` parses, and the result is rendered as the
    // card's href. An empty string here makes normalizeArticles skip the
    // article entirely.
    expect(canonicalizeUrl('javascript:alert(1)')).toBe('');
    expect(canonicalizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(canonicalizeUrl('http://example.com/story')).toBe('http://example.com/story');
  });
});

function fakeLookupDb(stored: string[], column: 'fingerprint' | 'canonical_url') {
  const chunks: string[][] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: string[]) => {
        chunks.push(params);
        return {
          all: async () => ({
            results: params.filter((p) => stored.includes(p)).map((value) => ({ [column]: value })),
          }),
        };
      },
      sql,
    }),
  };
  return { db: db as unknown as D1Database, chunks };
}

describe('knownFingerprints', () => {
  it('returns only the fingerprints already stored', async () => {
    const { db } = fakeLookupDb(['b', 'd'], 'fingerprint');
    const known = await knownFingerprints(db, ['a', 'b', 'c', 'd']);
    expect([...known].sort()).toEqual(['b', 'd']);
  });

  it('chunks the lookup so a full tick stays under D1 parameter limits', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `fp-${i}`);
    const { db, chunks } = fakeLookupDb([], 'fingerprint');
    await knownFingerprints(db, ids);

    expect(chunks.length).toBe(3);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(90);
    expect(chunks.flat().length).toBe(200);
  });

  it('does not query at all when a tick fetched nothing', async () => {
    const { db, chunks } = fakeLookupDb([], 'fingerprint');
    expect((await knownFingerprints(db, [])).size).toBe(0);
    expect(chunks).toHaveLength(0);
  });
});

describe('knownCanonicalUrls', () => {
  it('returns only the canonical URLs already stored', async () => {
    const { db } = fakeLookupDb(
      ['https://example.com/b', 'https://example.com/d'],
      'canonical_url',
    );
    const known = await knownCanonicalUrls(db, [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
      'https://example.com/d',
    ]);
    expect([...known].sort()).toEqual(['https://example.com/b', 'https://example.com/d']);
  });

  it('does not query at all when a tick fetched nothing', async () => {
    const { db, chunks } = fakeLookupDb([], 'canonical_url');
    expect((await knownCanonicalUrls(db, [])).size).toBe(0);
    expect(chunks).toHaveLength(0);
  });
});

describe('ingestAllSources', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches, normalises, and stores curated articles directly', async () => {
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>thonik – Home</title>
            <link>https://thonik.nl/</link>
            <description>From politics to culture.</description>
            <content:encoded><![CDATA[<p><small><a href="https://thonik.nl/">thonik.nl</a> · Design</small></p>]]></content:encoded>
            <media:thumbnail url="https://example.com/thumb.webp" />
          </item>
          <item>
            <title>C</title>
            <link>https://example.com/c</link>
            <description>A programming language.</description>
          </item>
          <item>
            <title>C++</title>
            <link>https://example.com/cpp</link>
            <description>Another programming language.</description>
          </item>
        </channel>
      </rss>`;

    const fetchMock = vi.fn().mockResolvedValue(new Response(rssXml, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const fakeDb = {
      batch: vi.fn(async () => []),
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT id FROM sources')) {
          return { all: async () => ({ results: [{ id: 'poche-explore' }] }) };
        }
        return {
          bind: vi.fn((..._params: unknown[]) => ({
            all: async () => ({ results: [] }),
            run: async () => ({ meta: { changes: 1 } }),
          })),
        };
      }),
    } as unknown as D1Database;

    const env = { DB: fakeDb } as unknown as Env;
    const report = await ingestAllSources(env);

    expect(report.sources).toBe(1);
    expect(report.stored).toBe(3);
    expect(report.uncategorized).toBe(2);
    expect(report.failed).toHaveLength(0);
  });
});
