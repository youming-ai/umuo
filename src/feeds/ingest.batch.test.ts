// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../data/api';
import type { ArticleEnrichment, FeedSource, RawArticle } from './types';

const enrichBatch = vi.hoisted(() => vi.fn());
const storeEnrichedArticle = vi.hoisted(() => vi.fn());
const parseRss = vi.hoisted(() => vi.fn());
const articleUrl = vi.hoisted(() => vi.fn((id: string) => `https://umuo.app/a/${id}`));
const notifyIndexNow = vi.hoisted(() => vi.fn());
const source = vi.hoisted(
  (): FeedSource => ({
    id: 'test-feed',
    kind: 'rss',
    name: 'Test feed',
    url: 'https://example.com/feed.xml',
    sport: 'soccer',
    authorityScore: 90,
    defaultEnabled: true,
  }),
);

vi.mock('./enrich', () => ({ enrichBatch, storeEnrichedArticle }));
vi.mock('./rss', () => ({ parseRss }));
vi.mock('./sources', () => ({ FEED_SOURCES: [source] }));
vi.mock('./indexnow', () => ({ articleUrl, notifyIndexNow }));
vi.mock('../newsFeed', () => ({ parseNewsFeed: vi.fn() }));

import { ingestAllSources } from './ingest';

const enrichment: ArticleEnrichment = {
  isFootball: true,
  competition: 'eng.1',
  articleType: 'news',
  tags: [],
  summary: 'A factual football summary.',
  blurb: 'A concise football blurb.',
  qualityScore: 90,
};

function article(index: number): Omit<RawArticle, 'canonicalUrl' | 'fingerprint'> {
  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceAuthority: source.authorityScore,
    comp: null,
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
    expect(notifyIndexNow).toHaveBeenCalledTimes(3);
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
});
