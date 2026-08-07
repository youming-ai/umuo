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
