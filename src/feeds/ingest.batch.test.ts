// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../data/api';
import type { ArticleEnrichment, FeedSource, RawArticle } from './types';

const enrichBatch = vi.hoisted(() => vi.fn());
const storeEnrichedArticle = vi.hoisted(() => vi.fn());
const normalizeTitle = vi.hoisted(
  () => (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, ''),
);
const parseRss = vi.hoisted(() => vi.fn());

const source = vi.hoisted(
  (): FeedSource => ({
    id: 'test-feed',
    kind: 'rss',
    name: 'Test feed',
    url: 'https://example.com/feed.xml',
    authorityScore: 90,
    defaultEnabled: true,
  }),
);

vi.mock('./enrich', () => ({ enrichBatch, storeEnrichedArticle, normalizeTitle }));
vi.mock('./rss', () => ({ parseRss }));
vi.mock('./sources', () => ({ FEED_SOURCES: [source] }));

import { ingestAllSources } from './ingest';

const enrichment: ArticleEnrichment = {
  isOnTopic: true,
  category: 'gpu',
  articleType: 'news',
  tags: [],
  summary: 'A factual hardware summary.',
  blurb: 'A concise hardware blurb.',
  qualityScore: 90,
};

function article(index: number): Omit<RawArticle, 'canonicalUrl' | 'fingerprint'> {
  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceAuthority: source.authorityScore,
    category: null,
    title: `Story ${index}`,
    description: `Description ${index}`,
    url: `https://example.com/story-${index}`,
    imageUrl: '',
    imageWidth: 0,
    imageHeight: 0,
    publishedAt: 1_700_000_000_000 + index,
    fetchedAt: 1_700_000_000_000 + index,
  };
}

function fakeDb(): D1Database {
  return {
    batch: vi.fn(async () => []),
    prepare: vi.fn((sql: string) => {
      if (sql.startsWith('SELECT id FROM sources')) {
        return { all: async () => ({ results: [{ id: source.id }] }) };
      }
      return {
        bind: (..._params: string[]) => ({ all: async () => ({ results: [] }) }),
      };
    }),
  } as unknown as D1Database;
}

function env(): Env {
  return {
    DB: fakeDb(),
    LLM_API_KEY: 'test-key',
    LLM_BASE_URL: 'https://api.example.com/v1',
    LLM_MODEL: 'test-model',
  } as Env;
}

function context(): ExecutionContext {
  return { waitUntil: vi.fn() } as unknown as ExecutionContext;
}

describe('ingestAllSources enrichment batches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<rss />')));
    enrichBatch.mockImplementation(async (_env: Env, articles: RawArticle[]) =>
      articles.map(() => enrichment),
    );
    storeEnrichedArticle.mockResolvedValue({ id: 'stored', status: 'stored' });
    parseRss.mockImplementation((..._args: unknown[]) =>
      Array.from({ length: 17 }, (_, index) => article(index)),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses eight-article calls and stores each completed chunk', async () => {
    const report = await ingestAllSources(env(), context());

    expect(enrichBatch.mock.calls.map((call) => call[1].length)).toEqual([8, 8, 1]);
    expect(storeEnrichedArticle).toHaveBeenCalledTimes(17);
    expect(report.stored).toBe(17);
  });

  it('keeps earlier chunk writes when a later enrichment call fails', async () => {
    enrichBatch
      .mockResolvedValueOnce(Array.from({ length: 8 }, () => enrichment))
      .mockRejectedValueOnce(new Error('LLM unavailable'));

    const report = await ingestAllSources(env(), context());

    expect(enrichBatch).toHaveBeenCalledTimes(2);
    expect(storeEnrichedArticle).toHaveBeenCalledTimes(8);
    expect(report.stored).toBe(8);
  });

  it('drops cross-source duplicates that share a normalized title', async () => {
    parseRss.mockImplementation(() => {
      const items = Array.from({ length: 17 }, (_, index) => article(index));
      // Two items whose titles differ only in punctuation/casing — the same
      // story syndicated across outlets, which the fingerprint (hostname is
      // part of it) would not catch.
      items[0] = { ...items[0], title: 'RTX 5080 double!' };
      items[1] = { ...items[1], title: 'RTX 5080 double' };
      return items;
    });

    const report = await ingestAllSources(env(), context());

    expect(storeEnrichedArticle).toHaveBeenCalledTimes(16);
    expect(report.stored).toBe(16);
  });
});
