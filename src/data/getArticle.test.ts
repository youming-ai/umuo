// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './api';
import { getArticle } from './api';

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

afterEach(() => vi.restoreAllMocks());

describe('getArticle', () => {
  it('never writes a KV entry for an id that does not exist in D1', async () => {
    // Regression: runCached cached the JSON string of the null row, so an
    // unauthenticated caller could grind /a/{id} for arbitrary ids and each
    // miss wrote a `article:{id}` key — the same unbounded KV write
    // amplification serveExplore already blocks for free-text search.
    const put = vi.fn();
    const env = {
      CACHE: { get: vi.fn().mockResolvedValue(null), put },
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null) })),
        })),
      },
    } as unknown as Env;

    const article = await getArticle('a'.repeat(64), env, ctx);
    expect(article).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it('still caches an existing article', async () => {
    const put = vi.fn();
    const row = {
      id: 'a'.repeat(64),
      title: 'Haaland double',
      description: 'teaser',
      ai_summary: 'summary',
      ai_blurb: 'blurb',
      canonical_url: 'https://example.com/x',
      image_url: '',
      image_width: 0,
      image_height: 0,
      source_id: 'bbc',
      source_name: 'BBC Sport',
      source_url: 'https://feeds.bbci.co.uk',
      published_at: 1_780_000_000_000,
      comp: 'eng.1',
      article_type: 'match-report',
      quality_score: 85,
      tags: '["match-report"]',
    };
    const env = {
      CACHE: { get: vi.fn().mockResolvedValue(null), put },
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(row) })),
        })),
      },
    } as unknown as Env;

    const article = await getArticle('a'.repeat(64), env, ctx);
    expect(article?.id).toBe('a'.repeat(64));
    expect(put).toHaveBeenCalledTimes(1);
  });
});
