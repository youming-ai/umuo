// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExploreArticle } from '../types';
import type { Env } from './api';
import { getRelatedArticles } from './api';

function envReturning(body: unknown): Env {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    CACHE: {
      get: vi.fn().mockResolvedValue({ body: json, at: Date.now() }),
      put: vi.fn(),
    },
  } as unknown as Env;
}

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

const sampleArticle: ExploreArticle = {
  id: 'art-1',
  title: 'Keychron launches Q1 Max',
  description: 'New keyboard launch',
  summary: 'Keychron has launched the Q1 Max.',
  blurb: 'Keychron launches Q1 Max.',
  url: 'https://example.com/art-1',
  imageUrl: 'https://example.com/img.jpg',
  imageWidth: 800,
  imageHeight: 600,
  sourceId: 'toms-hardware',
  sourceName: "Tom's Hardware",
  sourceDomain: 'tomshardware.com',
  publishedAt: 1700000000000,
  category: 'keyboards',
  articleType: 'news',
  qualityScore: 85,
  freshnessScore: 90,
  tags: ['keychron', 'keyboards'],
};

afterEach(() => vi.restoreAllMocks());

describe('getRelatedArticles', () => {
  it('returns mapped related articles from cached response', async () => {
    const rawRows = [
      {
        id: 'art-2',
        title: 'Ducky courts enthusiasts',
        description: 'Ducky keyboard news',
        ai_summary: 'Ducky in talks about a new board.',
        ai_blurb: 'Ducky courts enthusiasts.',
        canonical_url: 'https://example.com/art-2',
        image_url: '',
        image_width: 0,
        image_height: 0,
        source_id: 'kitguru',
        source_name: 'KitGuru',
        source_url: 'https://kitguru.net',
        published_at: 1700000001000,
        category: 'keyboards',
        article_type: 'news',
        quality_score: 80,
        freshness_score: 88,
        tags: JSON.stringify(['ducky', 'keyboards']),
      },
    ];

    const env = envReturning(rawRows);
    const related = await getRelatedArticles(sampleArticle, env, ctx);

    expect(related).toHaveLength(1);
    expect(related[0]?.id).toBe('art-2');
    expect(related[0]?.title).toBe('Ducky courts enthusiasts');
    expect(related[0]?.tags).toEqual(['ducky', 'keyboards']);
    expect(env.CACHE.get).toHaveBeenCalledWith('related:art-1:4', 'json');
  });

  it('builds parameterised D1 query on cache miss with category and tags', async () => {
    let capturedSql = '';
    let capturedBindings: unknown[] = [];

    const env = {
      CACHE: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      },
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => {
          capturedSql = sql;
          return {
            bind: vi.fn().mockImplementation((...bindings: unknown[]) => {
              capturedBindings = bindings;
              return {
                all: vi.fn().mockResolvedValue({
                  results: [
                    {
                      id: 'art-3',
                      title: 'Logitech update',
                      description: 'Logitech mouse news',
                      ai_summary: 'Logitech summary',
                      ai_blurb: 'Logitech blurb',
                      canonical_url: 'https://example.com/art-3',
                      image_url: '',
                      image_width: 0,
                      image_height: 0,
                      source_id: 'kitguru',
                      source_name: 'KitGuru',
                      source_url: 'https://kitguru.net',
                      published_at: 1700000002000,
                      category: 'mice',
                      article_type: 'news',
                      quality_score: 82,
                      freshness_score: 85,
                      tags: '["logitech"]',
                    },
                  ],
                }),
              };
            }),
          };
        }),
      },
    } as unknown as Env;

    const related = await getRelatedArticles(sampleArticle, env, ctx, 3);

    expect(env.CACHE.get).toHaveBeenCalledWith('related:art-1:3', 'json');
    expect(capturedSql).toContain('FROM articles a');
    expect(capturedSql).toContain('a.id != ?');
    expect(capturedSql).toContain('a.category = ?');
    expect(capturedSql).toContain('filter_tags.tag IN (?, ?)');
    expect(capturedBindings).toEqual(['art-1', 'keyboards', 'keychron', 'keyboards', 3]);
    expect(related).toHaveLength(1);
    expect(related[0]?.id).toBe('art-3');
  });

  it('degrades gracefully to empty array on non-ok response or error', async () => {
    const env = {
      CACHE: {
        get: vi.fn().mockRejectedValue(new Error('KV failure')),
        put: vi.fn(),
      },
      DB: {
        prepare: vi.fn().mockImplementation(() => {
          throw new Error('D1 failure');
        }),
      },
    } as unknown as Env;

    const related = await getRelatedArticles(sampleArticle, env, ctx);
    expect(related).toEqual([]);
  });

  it('handles malformed cache payload by returning empty array', async () => {
    const env = envReturning('not-valid-json');
    const related = await getRelatedArticles(sampleArticle, env, ctx);
    expect(related).toEqual([]);
  });
});
