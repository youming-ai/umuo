// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Env } from '../data/api';
import { normalizeTag, normalizeTitle, storeEnrichedArticle } from './enrich';
import type { ArticleEnrichment, RawArticle } from './types';

describe('normalizeTag', () => {
  it('collapses the spellings that split one topic into two facets', () => {
    // The exact pair that showed up twice in the rail after the first ingest.
    expect(normalizeTag('Premier League')).toBe('premier-league');
    expect(normalizeTag('premier-league')).toBe('premier-league');
    expect(normalizeTag('La Liga')).toBe('la-liga');
  });

  it('normalises padding, casing and repeated separators', () => {
    expect(normalizeTag('  Champions   League  ')).toBe('champions-league');
    expect(normalizeTag('MAN--UTD')).toBe('man-utd');
    expect(normalizeTag('-transfers-')).toBe('transfers');
  });

  it('returns an empty string for whitespace-only tags so they can be dropped', () => {
    expect(normalizeTag('   ')).toBe('');
    expect(normalizeTag('-')).toBe('');
  });
});

describe('normalizeTitle', () => {
  it('collides punctuation, casing and padding variants of the same headline', () => {
    expect(normalizeTitle('Haaland double!')).toBe('haalanddouble');
    expect(normalizeTitle('Haaland double')).toBe('haalanddouble');
    expect(normalizeTitle('  Haaland   DOUBLE  ')).toBe('haalanddouble');
  });

  it('never collapses a non-Latin headline to an empty dedup key', () => {
    // Regression: /[^a-z0-9]+/g stripped every non-ASCII headline to '', so
    // the first one stored made knownTitles treat every later non-English
    // story as already ingested and skip it forever.
    expect(normalizeTitle('梅西加盟迈阿密国际')).toBe('梅西加盟迈阿密国际');
    expect(normalizeTitle('Вингер подписал контракт')).toBe('вингер подписал контракт');
  });
});

const ARTICLE = {
  sourceId: 'bbc',
  sourceName: 'BBC Sport',
  sourceAuthority: 92,
  comp: 'eng.1',
  title: 'Haaland double sees City past Arsenal',
  description: 'teaser',
  body: '',
  url: 'https://example.com/story',
  canonicalUrl: 'https://example.com/story',
  imageUrl: '',
  imageWidth: 0,
  imageHeight: 0,
  publishedAt: 1_780_000_000_000,
  fetchedAt: 1_780_000_000_000,
  fingerprint: 'fp-1',
} as RawArticle;

function enrichment(qualityScore: number, isFootball = true): ArticleEnrichment {
  return {
    isFootball,
    competition: 'eng.1',
    articleType: 'match-report',
    tags: ['match-report'],
    summary: 'summary',
    blurb: 'blurb',
    qualityScore,
  };
}

/** Fake D1 that captures the bound params of the INSERT so the stored status,
 *  score and title_norm can be asserted. */
function makeStoreEnv() {
  const bound: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...params: unknown[]) => {
        bound.push(params);
        return { run: async () => ({ meta: { changes: 1 } }) };
      },
    }),
    batch: async () => [],
  };
  return { env: { DB: db } as unknown as Env, bound };
}

describe('storeEnrichedArticle', () => {
  // The gate is on the blended score (qualityScore × 0.7 + sourceAuthority ×
  // 0.3). With sourceAuthority 92: qualityScore 47 → 61 (published), 45 → 59
  // (filtered), straddling MIN_QUALITY_SCORE = 60.
  it('stores football at or above the quality threshold as published', async () => {
    const { env, bound } = makeStoreEnv();
    await storeEnrichedArticle(env, ARTICLE, enrichment(47));
    expect(bound[0][17]).toBe(61); // quality_score
    expect(bound[0][18]).toBe('published'); // status
  });

  it('filters football below the quality threshold', async () => {
    const { env, bound } = makeStoreEnv();
    await storeEnrichedArticle(env, ARTICLE, enrichment(45));
    expect(bound[0][17]).toBe(59); // quality_score
    expect(bound[0][18]).toBe('filtered');
  });

  it('filters non-football regardless of score', async () => {
    const { env, bound } = makeStoreEnv();
    await storeEnrichedArticle(env, ARTICLE, enrichment(85, false));
    expect(bound[0][18]).toBe('filtered');
  });

  it('writes the normalized title for cross-source dedup', async () => {
    const { env, bound } = makeStoreEnv();
    await storeEnrichedArticle(env, ARTICLE, enrichment(85));
    expect(bound[0][5]).toBe(normalizeTitle(ARTICLE.title));
  });
});
