import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, knownFingerprints } from './ingest';

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
    // `new URL('javascript:alert(1)')` parses, and the result is rendered as an
    // href on the cards and the detail-page CTA. An empty string here makes
    // normalizeArticles skip the article entirely.
    expect(canonicalizeUrl('javascript:alert(1)')).toBe('');
    expect(canonicalizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(canonicalizeUrl('http://example.com/story')).toBe('http://example.com/story');
  });
});

describe('knownFingerprints', () => {
  function fakeDb(stored: string[]) {
    const chunks: string[][] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: string[]) => {
          chunks.push(params);
          return {
            all: async () => ({
              results: params
                .filter((p) => stored.includes(p))
                .map((fingerprint) => ({
                  fingerprint,
                })),
            }),
          };
        },
        sql,
      }),
    };
    return { db: db as unknown as D1Database, chunks };
  }

  it('returns only the fingerprints already stored', async () => {
    const { db } = fakeDb(['b', 'd']);
    const known = await knownFingerprints(db, ['a', 'b', 'c', 'd']);
    expect([...known].sort()).toEqual(['b', 'd']);
  });

  it('chunks the lookup so a full tick stays under D1 parameter limits', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `fp-${i}`);
    const { db, chunks } = fakeDb([]);
    await knownFingerprints(db, ids);

    expect(chunks.length).toBe(3);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(90);
    expect(chunks.flat().length).toBe(200);
  });

  it('does not query at all when a tick fetched nothing', async () => {
    const { db, chunks } = fakeDb([]);
    expect((await knownFingerprints(db, [])).size).toBe(0);
    expect(chunks).toHaveLength(0);
  });
});
