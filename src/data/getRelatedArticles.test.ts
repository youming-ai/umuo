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
  title: 'Arsenal sign striker',
  description: 'Big transfer news',
  summary: 'Arsenal has completed the signing.',
  blurb: 'Arsenal sign striker.',
  url: 'https://example.com/art-1',
  imageUrl: 'https://example.com/img.jpg',
  imageWidth: 800,
  imageHeight: 600,
  sourceId: 'bbc',
  sourceName: 'BBC Sport',
  sourceDomain: 'bbc.com',
  publishedAt: 1700000000000,
  competition: 'eng.1',
  articleType: 'news',
  qualityScore: 85,
  freshnessScore: 90,
  tags: ['arsenal', 'transfer'],
};

afterEach(() => vi.restoreAllMocks());

describe('getRelatedArticles', () => {
  it('returns mapped related articles from cached response', async () => {
    const rawRows = [
      {
        id: 'art-2',
        title: 'Chelsea eye defender',
        description: 'Chelsea transfer news',
        ai_summary: 'Chelsea in talks with defender.',
        ai_blurb: 'Chelsea eye defender.',
        canonical_url: 'https://example.com/art-2',
        image_url: '',
        image_width: 0,
        image_height: 0,
        source_id: 'guardian',
        source_name: 'The Guardian',
        source_url: 'https://theguardian.com',
        published_at: 1700000001000,
        comp: 'eng.1',
        article_type: 'news',
        quality_score: 80,
        freshness_score: 88,
        tags: JSON.stringify(['chelsea', 'transfer']),
      },
    ];

    const env = envReturning(rawRows);
    const related = await getRelatedArticles(sampleArticle, env, ctx);

    expect(related).toHaveLength(1);
    expect(related[0]?.id).toBe('art-2');
    expect(related[0]?.title).toBe('Chelsea eye defender');
    expect(related[0]?.tags).toEqual(['chelsea', 'transfer']);
    expect(env.CACHE.get).toHaveBeenCalledWith('related:art-1:4', 'json');
  });

  it('builds parameterised D1 query on cache miss with competition and tags', async () => {
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
                      title: 'Spurs update',
                      description: 'Spurs news',
                      ai_summary: 'Spurs summary',
                      ai_blurb: 'Spurs blurb',
                      canonical_url: 'https://example.com/art-3',
                      image_url: '',
                      image_width: 0,
                      image_height: 0,
                      source_id: 'sky',
                      source_name: 'Sky Sports',
                      source_url: 'https://skysports.com',
                      published_at: 1700000002000,
                      comp: 'eng.1',
                      article_type: 'news',
                      quality_score: 82,
                      freshness_score: 85,
                      tags: '["spurs"]',
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
    expect(capturedSql).toContain('a.comp = ?');
    expect(capturedSql).toContain('filter_tags.tag IN (?, ?)');
    expect(capturedBindings).toEqual(['art-1', 'eng.1', 'arsenal', 'transfer', 3]);
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
