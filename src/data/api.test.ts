import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPETITIONS, seasonForDate } from '../competitions';
import type { NewsItem } from '../types';
import {
  type Env,
  getAggregatedNews,
  getCompetitionView,
  getCompMatchBySlug,
  getCompNews,
  getHomeView,
  mergeNewsLists,
  serve,
} from './api';

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

describe('getCompNews', () => {
  it('prioritizes articles matching the target competition league slug', async () => {
    const rawNews = JSON.stringify({
      articles: [
        {
          id: 'generic-1',
          headline: 'Generic Soccer News',
          published: '2026-07-05T00:00:00Z',
          categories: [{ type: 'league', description: 'Soccer' }],
        },
        {
          id: 'esp-1',
          headline: 'Spanish LALIGA Story',
          published: '2026-07-01T00:00:00Z',
          categories: [
            {
              type: 'league',
              description: 'Spanish LALIGA',
              league: {
                links: {
                  web: { leagues: { href: 'https://www.espn.com/soccer/league/_/name/esp.1' } },
                },
              },
            },
          ],
        },
      ],
    });

    vi.stubGlobal('fetch', fetchByLeague([{ match: '/esp.1/news', body: rawNews }]));

    const comp = COMPETITIONS['esp.1'];
    const items = await getCompNews(comp, mockEnv() as unknown as Env, mockCtx());
    expect(items[0].id).toBe('esp-1');
    vi.unstubAllGlobals();
  });
});

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
// getHomeView runs the marquee selection server-side, which only keeps live /
// today / nearest-upcoming matches — so a fixture needs a kickoff on today's date.
function todayEvent(id: string): string {
  return JSON.stringify({
    events: [
      {
        id,
        date: new Date().toISOString(),
        competitions: [
          {
            status: { type: { state: 'pre' } },
            competitors: [
              { homeAway: 'home', score: '0', team: { id: '1', displayName: 'A' } },
              { homeAway: 'away', score: '0', team: { id: '2', displayName: 'B' } },
            ],
            details: [],
          },
        ],
      },
    ],
  });
}

describe('getHomeView', () => {
  it('fans out news and scoreboards, tagging each match with its comp key', async () => {
    vi.stubGlobal(
      'fetch',
      fetchByLeague([
        { match: '/eng.1/news', body: newsJson([item('e1', '2026-07-03T00:00:00Z', 'EPL')]) },
        { match: '/eng.1/scoreboard', body: todayEvent('m1') },
        { match: '/nba/scoreboard', body: todayEvent('m2') },
      ]),
    );
    const out = await getHomeView(mockEnv() as unknown as Env, mockCtx());
    expect(out.news.length).toBeGreaterThan(0);
    const taggedComps = out.scoreboardData.map((m) => m.comp);
    expect(taggedComps).toContain('eng.1');
    expect(taggedComps).toContain('nba');
    vi.unstubAllGlobals();
  });
});

// A scoreboard event the soccer adapter can normalize into one CompMatch.
const oneEvent = JSON.stringify({
  events: [
    {
      id: '1',
      date: '2026-08-01T12:00Z',
      competitions: [
        {
          status: { type: { state: 'pre' } },
          competitors: [
            { homeAway: 'home', score: '0', team: { id: '1', displayName: 'Arsenal' } },
            { homeAway: 'away', score: '0', team: { id: '2', displayName: 'Chelsea' } },
          ],
          details: [],
        },
      ],
    },
  ],
});

describe('upstream unavailable vs missing entity', () => {
  const EPL = COMPETITIONS['eng.1'];

  it('getCompMatchBySlug returns null for an unknown slug on a healthy scoreboard', async () => {
    vi.stubGlobal('fetch', fetchByLeague([{ match: '/eng.1/scoreboard', body: oneEvent }]));
    const out = await getCompMatchBySlug(
      EPL,
      'no-such-match',
      mockEnv() as unknown as Env,
      mockCtx(),
    );
    expect(out).toBeNull();
    vi.unstubAllGlobals();
  });

  it('getCompMatchBySlug throws when the scoreboard is unavailable (so the page can 503)', async () => {
    vi.stubGlobal(
      'fetch',
      fetchByLeague([{ match: '/eng.1/scoreboard', status: 404, body: 'nope' }]),
    );
    await expect(
      getCompMatchBySlug(EPL, 'arsenal-vs-chelsea', mockEnv() as unknown as Env, mockCtx()),
    ).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it('getCompetitionView keeps scoreboard matches when standings is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      fetchByLeague([
        { match: '/eng.1/scoreboard', body: oneEvent },
        { match: '/eng.1/standings', status: 404, body: 'nope' },
      ]),
    );
    const view = await getCompetitionView(EPL, mockEnv() as unknown as Env, mockCtx());
    expect(view.matches).toHaveLength(1);
    expect(view.standings).toEqual({ kind: 'soccer', groups: [] });
    vi.unstubAllGlobals();
  });

  it('serves STALE and keeps the cache when a 200 body is not usable JSON', async () => {
    const store = new Map<string, string>();
    const env = {
      CACHE: {
        get: vi.fn(async (k: string) => {
          const v = store.get(k);
          return v ? JSON.parse(v) : null;
        }),
        put: vi.fn(async (k: string, v: string) => {
          store.set(k, v);
        }),
      },
    } as unknown as Env;
    // A good, but stale, stored copy (scoreboard fresh window is 60s).
    const good = '{"events":[]}';
    const key = `eng.1:scoreboard:${EPL.season ?? seasonForDate(EPL.sport, new Date())}`;
    store.set(key, JSON.stringify({ body: good, at: Date.now() - 600_000 }));

    vi.stubGlobal(
      'fetch',
      fetchByLeague([{ match: '/eng.1/scoreboard', body: '<html>rate limited</html>' }]),
    );
    const res = await serve(EPL, 'scoreboard', env, mockCtx());
    expect(res.headers.get('x-cache')).toBe('STALE');
    expect(await res.text()).toBe(good);
    expect(JSON.parse(store.get(key)!).body).toBe(good); // garbage never replaced it
    vi.unstubAllGlobals();
  });
});
