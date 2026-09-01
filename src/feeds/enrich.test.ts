// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Env } from '../data/api';
import { normalizeTag, normalizeTitle, storeEnrichedArticle } from './enrich';
import type { ArticleEnrichment, RawArticle } from './types';

describe('normalizeTag', () => {
  it('collapses the spellings that split one topic into two facets', () => {
    // The exact pair that showed up twice in the rail after the first ingest.
    expect(normalizeTag('Mechanical Keyboards')).toBe('mechanical-keyboards');
    expect(normalizeTag('mechanical-keyboards')).toBe('mechanical-keyboards');
    expect(normalizeTag('Solid State Drive')).toBe('solid-state-drive');
  });

  it('normalises padding, casing and repeated separators', () => {
    expect(normalizeTag('  Mechanical   Keyboard  ')).toBe('mechanical-keyboard');
    expect(normalizeTag('RTX--5080')).toBe('rtx-5080');
    expect(normalizeTag('-deals-')).toBe('deals');
  });

  it('returns an empty string for whitespace-only tags so they can be dropped', () => {
    expect(normalizeTag('   ')).toBe('');
    expect(normalizeTag('-')).toBe('');
  });
});

describe('normalizeTitle', () => {
  it('collides punctuation, casing and padding variants of the same headline', () => {
    expect(normalizeTitle('RTX 5080 review!')).toBe('rtx5080review');
    expect(normalizeTitle('RTX 5080 review')).toBe('rtx5080review');
    expect(normalizeTitle('  RTX   5080  REVIEW  ')).toBe('rtx5080review');
  });

  it('never collapses a non-Latin headline to an empty dedup key', () => {
    // Regression: /[^a-z0-9]+/g stripped every non-ASCII headline to '', so
    // the first one stored made knownTitles treat every later non-English
    // story as already ingested and skip it forever.
    expect(normalizeTitle('机械键盘评测')).toBe('机械键盘评测');
    expect(normalizeTitle('Обзор видеокарты')).toBe('обзор видеокарты');
  });
});

const ARTICLE = {
  sourceId: 'toms-hardware',
  sourceName: "Tom's Hardware",
  sourceAuthority: 92,
  category: 'gpu',
  title: 'RTX 5080 review sees strong uplift',
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

function enrichment(qualityScore: number, isOnTopic = true): ArticleEnrichment {
  return {
    isOnTopic,
    category: 'gpu',
    articleType: 'review',
    tags: ['gpu'],
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
  it('stores on-topic stories at or above the quality threshold as published', async () => {
    const { env, bound } = makeStoreEnv();
    await storeEnrichedArticle(env, ARTICLE, enrichment(47));
    expect(bound[0][17]).toBe(61); // quality_score
    expect(bound[0][18]).toBe('published'); // status
  });

  it('filters on-topic stories below the quality threshold', async () => {
    const { env, bound } = makeStoreEnv();
    await storeEnrichedArticle(env, ARTICLE, enrichment(45));
    expect(bound[0][17]).toBe(59); // quality_score
    expect(bound[0][18]).toBe('filtered');
  });

  it('filters off-topic stories regardless of score', async () => {
    const { env, bound } = makeStoreEnv();
    await storeEnrichedArticle(env, ARTICLE, enrichment(85, false));
    expect(bound[0][18]).toBe('filtered');
  });

  it('writes the normalized title for cross-source dedup', async () => {
    const { env, bound } = makeStoreEnv();
    await storeEnrichedArticle(env, ARTICLE, enrichment(85));
    expect(bound[0][5]).toBe(normalizeTitle(ARTICLE.title));
  });

  it('binds the canonical category, falling back to the source preset', async () => {
    const { env, bound } = makeStoreEnv();
    await storeEnrichedArticle(env, ARTICLE, enrichment(85));
    expect(bound[0][14]).toBe('gpu'); // category
  });
});
