import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsItem } from '../types';
import { type Env, getAggregatedNews, mergeNewsLists } from './api';

const item = (id: string, published: string, headline = id): NewsItem => ({
  id,
  headline,
  description: '',
  published,
  byline: '',
  imageUrl: '',
  link: '',
  tags: [],
});

describe('mergeNewsLists', () => {
  it('merges lists and sorts by published desc (newest first)', () => {
    const out = mergeNewsLists([
      [item('a', '2026-07-01T00:00:00Z')],
      [item('b', '2026-07-05T00:00:00Z'), item('c', '2026-06-01T00:00:00Z')],
    ]);
    expect(out.map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('dedupes items that share an id (first occurrence wins)', () => {
    const out = mergeNewsLists([
      [item('x', '2026-07-01T00:00:00Z', 'first')],
      [item('x', '2026-07-09T00:00:00Z', 'second')],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.headline).toBe('first');
  });

  it('keeps id-less items (no dedupe) and tolerates empty lists', () => {
    const noId: NewsItem = { ...item('', '2026-07-01T00:00:00Z', 'noid') };
    const out = mergeNewsLists([[noId], [], [item('y', '2026-07-02T00:00:00Z')]]);
    expect(out.map((n) => n.headline)).toEqual(['y', 'noid']);
  });
});

// ESPN site.api per-league news wraps items in `articles`; parseNewsFeed reads
// that shape. Build a minimal payload for the fetch mock.
function newsJson(items: NewsItem[]): string {
  return JSON.stringify({
    articles: items.map((it) => ({
      id: it.id,
      headline: it.headline,
      description: it.description,
      published: it.published,
      byline: it.byline,
      images: it.imageUrl ? [{ url: it.imageUrl }] : [],
      links: { web: { href: it.link } },
      categories: [],
    })),
  });
}

// fetch mock: returns the first route whose `match` substring is in the URL.
function fetchByLeague(routes: { match: string; status?: number; body?: string }[]): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    for (const r of routes) {
      if (u.includes(r.match)) {
        return new Response(r.body ?? '{"articles":[]}', {
          status: r.status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{"articles":[]}', { status: 200 });
  }) as unknown as typeof fetch;
}

function mockEnv() {
  const store = new Map<string, string>();
  return {
    CACHE: {
      get: vi.fn(async (k: string) => {
        const v = store.get(k);
        return v ? JSON.parse(v) : null;
      }),
      put: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    },
  };
}

function mockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(async () => {}),
    passThroughOnException: vi.fn(),
    props: {},
    tracing: {},
  } as unknown as ExecutionContext;
}

describe('getAggregatedNews', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fans out across competitions and merges newest-first', async () => {
    vi.stubGlobal(
      'fetch',
      fetchByLeague([
        { match: '/eng.1/news', body: newsJson([item('e1', '2026-07-03T00:00:00Z', 'EPL')]) },
        { match: '/nba/news', body: newsJson([item('nba1', '2026-07-07T00:00:00Z', 'NBA')]) },
      ]),
    );
    const out = await getAggregatedNews(mockEnv() as unknown as Env, mockCtx());
    expect(out.map((n) => n.id)).toEqual(['nba1', 'e1']);
    vi.unstubAllGlobals();
  });

  it('tolerates a competition whose news fetch fails (4xx → soft-empty)', async () => {
    // 4xx returns immediately (no retry), keeping the test fast.
    vi.stubGlobal(
      'fetch',
      fetchByLeague([
        { match: '/eng.1/news', body: newsJson([item('e1', '2026-07-03T00:00:00Z')]) },
        { match: '/nba/news', status: 404, body: 'Not found' },
      ]),
    );
    const out = await getAggregatedNews(mockEnv() as unknown as Env, mockCtx());
    expect(out.map((n) => n.id)).toEqual(['e1']);
    vi.unstubAllGlobals();
  });
});
