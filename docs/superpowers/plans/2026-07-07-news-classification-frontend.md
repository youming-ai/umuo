# News Classification Frontend (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-competition news section — a filterable feed (global / by sport / by league / by team) consuming the Phase-1 `/api/news` proxy, with team Tags parsed from ESPN `categories`.

**Architecture:** A pure `parseNewsFeed(json)` (defensive, like the adapters) turns raw ESPN "now" JSON into `NewsItem[]` with extracted Tags. A `useNews(scope)` hook (SWR + visibility-gated polling, same idiom as `useLeaders`) fetches `/api/news` with the scope's query. `NewsView` is a self-contained container page (calls the hook itself) rendering a category-nav strip + external-linking cards. The router gains a comp-less top-level `news` route kind; `App` renders `NewsView` in its own branch (not gated on competition data); `Header` gets a cross-comp "News" entry.

**Tech Stack:** React 18, TypeScript, Tailwind (design tokens), custom History-API router, Vitest + Testing Library.

## Global Constraints

- Biome: 2-space indent, single quotes, semicolons, trailing commas, line width 100. Run `npm run lint` before every commit.
- Colors only through tokens (`--c-*` → Tailwind `night`/`panel`/`panel2`/`line`/`chalk`/`chalkdim`/`pitch`/etc.). No hardcoded hex/rgba; `bg-white/5`-style overlays are the accepted elevation idiom.
- i18n: every new key must be added to ALL FOUR languages (`en`, `zh`, `ja`, `ko`) in `src/i18n/messages.ts` — `messages.test.ts` enforces key parity and will fail otherwise.
- Routes carry NO query string — `parseRoute` strips `?…`. All news scope lives in the PATH (`/news`, `/news/<sport>`, `/news/league/<slug>`, `/news/team/<abbrev>`).
- Data hooks follow the house SWR idiom: `AbortController` per fetch, visibility-gated polling (paused when tab hidden), show cached immediately + refetch in background, reset cache when the key changes. Model on `src/hooks/useLeaders.ts`.
- `/api/news` supports ONLY `limit`/`sport`/`leagues`/`team` filters (Phase-1 whitelist). There is NO athlete filter and no league-slug for arbitrary `league` categories — so only **team** Tags are clickable; athlete/league Tags render as non-interactive labels.
- News cards link OUT to `espn.com` (`links.web.href`) in a new tab (`target="_blank" rel="noopener noreferrer"`). No in-app article/reader page in this phase (that's Phase 3).
- Tests colocated as `*.test.ts(x)`; jsdom; `fileParallelism: false` (serial). Both tsconfigs must type-check: `npm run typecheck`.

## Data contract (verified against the live `/api/news` on 2026-07-07)

Response: `{ headlines: Headline[], resultsCount, ... }`. Each `Headline`:
- `id` (number, e.g. `49074981`), `headline` (string), `description` (string), `published` (ISO string), `byline` (string)
- `images`: `[{ url, name, width, height }, …]` — may be empty
- `links.web.href` (string) — the external article URL
- `categories`: heterogeneous `[{ type, … }]`. Types seen: `guid`, `team`, `league`, `topic`, `athlete`, `event`, `contributor`, `sportseason`. Relevant shapes:
  - team: `{ type:'team', teamId, description, team:{ id, abbreviation, shortDisplayName } }`
  - athlete: `{ type:'athlete', athleteId, description, athlete:{ id } }`
  - league: `{ type:'league', leagueId, description, league:{ id, abbreviation } }`
- ⚠️ team/athlete ids are `now.core.api` GLOBAL ids and may name entities in NO app competition (e.g. NRL/MLB). They are NOT the comp-scoped ids used by `/team/:id` — do not link Tags to those pages.

---

### Task 1: News types + `parseNewsFeed` + category Tags

**Files:**
- Modify: `src/types/index.ts` (append the news types)
- Create: `src/newsFeed.ts`
- Test: `src/newsFeed.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `type NewsScope = { by:'all' } | { by:'sport'; sport:string } | { by:'league'; league:string } | { by:'team'; team:string }`
  - `interface NewsTag { kind:'team'|'athlete'|'league'; label:string; team?:string }`
  - `interface NewsItem { id:string; headline:string; description:string; published:string; byline:string; imageUrl:string; link:string; tags:NewsTag[] }`
  - `parseNewsFeed(json: unknown): NewsItem[]`
  - `NEWS_NAV: { key:string; scope:NewsScope; labelKey:string }[]`

- [ ] **Step 1: Write the failing test**

Create `src/newsFeed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NEWS_NAV, parseNewsFeed } from './newsFeed';

const feed = {
  headlines: [
    {
      id: 49074981,
      headline: 'Cape Verde hold Spain',
      description: 'A day of draws',
      published: '2026-06-16T03:20:39Z',
      byline: 'ESPN Staff',
      images: [{ url: 'https://a.espncdn.com/x.jpg', name: 'x' }],
      links: { web: { href: 'https://www.espn.com/story/1' } },
      categories: [
        { type: 'contributor', description: 'ESPN Staff Profile' },
        { type: 'team', teamId: 289200, description: 'Wests Tigers', team: { id: 289200, abbreviation: 'WES' } },
        { type: 'athlete', athleteId: 31870, description: 'Max Kepler', athlete: { id: 31870 } },
        { type: 'league', leagueId: 8370, description: 'National Rugby League', league: { id: 8370, abbreviation: 'NRL' } },
        { type: 'team', teamId: 289200, description: 'Wests Tigers', team: { id: 289200, abbreviation: 'WES' } },
      ],
    },
  ],
};

describe('parseNewsFeed', () => {
  it('maps headlines into NewsItem with the first image and external link', () => {
    const items = parseNewsFeed(feed);
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0.id).toBe('49074981');
    expect(it0.headline).toBe('Cape Verde hold Spain');
    expect(it0.imageUrl).toBe('https://a.espncdn.com/x.jpg');
    expect(it0.link).toBe('https://www.espn.com/story/1');
    expect(it0.byline).toBe('ESPN Staff');
  });

  it('extracts team/athlete/league tags, dedupes, and lowercases the team abbrev', () => {
    const tags = parseNewsFeed(feed)[0].tags;
    expect(tags).toEqual([
      { kind: 'team', label: 'Wests Tigers', team: 'wes' },
      { kind: 'athlete', label: 'Max Kepler' },
      { kind: 'league', label: 'National Rugby League' },
    ]);
  });

  it('is defensive: junk in yields an empty array, missing fields default', () => {
    expect(parseNewsFeed(null)).toEqual([]);
    expect(parseNewsFeed({})).toEqual([]);
    expect(parseNewsFeed({ headlines: [{}] })).toEqual([
      { id: '', headline: '', description: '', published: '', byline: '', imageUrl: '', link: '', tags: [] },
    ]);
  });

  it('NEWS_NAV starts with the all scope', () => {
    expect(NEWS_NAV[0].scope).toEqual({ by: 'all' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/newsFeed.test.ts`
Expected: FAIL — `Failed to resolve import "./newsFeed"`.

- [ ] **Step 3: Add the types**

Append to `src/types/index.ts`:

```ts
// --- news (Phase 2) ---
// What the news feed is scoped to. Drives both the /api/news query and the
// /news/... route. NOTE: /api/news only filters by sport/leagues/team — there
// is no athlete filter (see NewsTag).
export type NewsScope =
  | { by: 'all' }
  | { by: 'sport'; sport: string }
  | { by: 'league'; league: string }
  | { by: 'team'; team: string };

// An entity parsed from a headline's ESPN `categories`. `team` (lowercase
// abbreviation) is set only for kind 'team' — that's the only kind /api/news
// can filter on, so it's the only clickable Tag.
export interface NewsTag {
  kind: 'team' | 'athlete' | 'league';
  label: string;
  team?: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  description: string;
  published: string; // ISO
  byline: string;
  imageUrl: string; // '' when the headline has no image
  link: string; // external espn.com article URL (links.web.href)
  tags: NewsTag[];
}
```

- [ ] **Step 4: Write `src/newsFeed.ts`**

```ts
// Pure, defensive parse of ESPN's "now" news JSON into the app's NewsItem[].
// ESPN JSON is untyped/heterogeneous (categories mix team/athlete/league/guid/
// topic/…), so coerce with obj()/arr()/str() rather than trusting shapes —
// same discipline as the sport adapters. No DOM/React: unit-testable in isolation.
import type { NewsItem, NewsScope, NewsTag } from './types';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown): Record<string, unknown> {
  return isObj(v) ? v : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

// Pull team/athlete/league entities out of a headline's `categories`, deduped.
function tagsFrom(categories: unknown): NewsTag[] {
  const tags: NewsTag[] = [];
  const seen = new Set<string>();
  for (const raw of arr(categories)) {
    const c = obj(raw);
    const type = str(c.type);
    if (type === 'team') {
      const label = str(c.description) || str(obj(c.team).shortDisplayName);
      const team = str(obj(c.team).abbreviation).toLowerCase();
      const key = `team:${team}:${label}`;
      if (label && !seen.has(key)) {
        seen.add(key);
        tags.push(team ? { kind: 'team', label, team } : { kind: 'team', label });
      }
    } else if (type === 'athlete') {
      const label = str(c.description) || str(obj(c.athlete).description);
      const key = `athlete:${label}`;
      if (label && !seen.has(key)) {
        seen.add(key);
        tags.push({ kind: 'athlete', label });
      }
    } else if (type === 'league') {
      const label = str(c.description) || str(obj(c.league).description);
      const key = `league:${label}`;
      if (label && !seen.has(key)) {
        seen.add(key);
        tags.push({ kind: 'league', label });
      }
    }
    // ignore guid/topic/event/contributor/sportseason
  }
  return tags;
}

export function parseNewsFeed(json: unknown): NewsItem[] {
  return arr(obj(json).headlines).map((raw): NewsItem => {
    const h = obj(raw);
    return {
      id: str(h.id) || str(h.nowId),
      headline: str(h.headline) || str(h.title),
      description: str(h.description),
      published: str(h.published),
      byline: str(h.byline),
      imageUrl: str(obj(arr(h.images)[0]).url),
      link: str(obj(obj(obj(h.links).web).href ? obj(h.links).web : {}).href),
      tags: tagsFrom(h.categories),
    };
  });
}

// The category-nav strip. Kept small and explicit (YAGNI): the sports/leagues
// the app actually surfaces. Extend when a new section is needed.
export const NEWS_NAV: { key: string; scope: NewsScope; labelKey: string }[] = [
  { key: 'all', scope: { by: 'all' }, labelKey: 'news.all' },
  { key: 'soccer', scope: { by: 'sport', sport: 'soccer' }, labelKey: 'news.soccer' },
  { key: 'basketball', scope: { by: 'sport', sport: 'basketball' }, labelKey: 'news.basketball' },
  { key: 'nba', scope: { by: 'league', league: 'nba' }, labelKey: 'news.nba' },
  { key: 'eng.1', scope: { by: 'league', league: 'eng.1' }, labelKey: 'news.eng1' },
];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/newsFeed.test.ts`
Expected: PASS (4 tests). If the `link` assertion fails, simplify the `link` line to `str(obj(obj(h.links).web).href)` and re-run — that yields the same result for the fixture; the guarded form only avoids constructing an intermediate when `web.href` is absent.

- [ ] **Step 6: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

```bash
git add src/types/index.ts src/newsFeed.ts src/newsFeed.test.ts
git commit -m "feat(news): NewsItem types + defensive parseNewsFeed + category tags"
```

---

### Task 2: Router `news` route kind

**Files:**
- Modify: `src/utils/router.ts` (import `NewsScope`; extend `Route`; add a `news` branch in `parseRoute`; add a `news` case in `pathFor`)
- Test: `src/utils/router.test.tsx` (add news parse/pathFor round-trip tests)

**Interfaces:**
- Consumes (Task 1): `NewsScope` from `../types`.
- Produces: `Route` gains `| { kind: 'news'; scope: NewsScope }`. `parseRoute('/news/...')` and `pathFor({ kind:'news', scope })` round-trip.

- [ ] **Step 1: Write the failing test**

Add to `src/utils/router.test.tsx`:

```ts
import { parseRoute, pathFor } from './router';

describe('news routes', () => {
  it('parses the news scopes from the path', () => {
    expect(parseRoute('/news')).toEqual({ kind: 'news', scope: { by: 'all' } });
    expect(parseRoute('/news/soccer')).toEqual({ kind: 'news', scope: { by: 'sport', sport: 'soccer' } });
    expect(parseRoute('/news/league/nba')).toEqual({ kind: 'news', scope: { by: 'league', league: 'nba' } });
    expect(parseRoute('/news/team/lal')).toEqual({ kind: 'news', scope: { by: 'team', team: 'lal' } });
  });

  it('round-trips scope → path → scope', () => {
    for (const scope of [
      { by: 'all' } as const,
      { by: 'sport', sport: 'basketball' } as const,
      { by: 'league', league: 'eng.1' } as const,
      { by: 'team', team: 'che' } as const,
    ]) {
      expect(parseRoute(pathFor({ kind: 'news', scope }))).toEqual({ kind: 'news', scope });
    }
  });

  it('falls back to the all scope for an unknown news shape', () => {
    expect(parseRoute('/news/league')).toEqual({ kind: 'news', scope: { by: 'all' } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/router.test.tsx -t "news routes"`
Expected: FAIL — `parseRoute` returns a `section` route (news not handled yet).

- [ ] **Step 3: Import the type and extend `Route`**

In `src/utils/router.ts`, change the top import:

```ts
import { COMPETITIONS, DEFAULT_COMPETITION } from '../competitions';
import type { NewsScope } from '../types';
```

Extend the `Route` union (after the `player` member):

```ts
export type Route =
  | { kind: 'section'; comp: string; section: Section }
  | { kind: 'match'; comp: string; slug: string }
  | { kind: 'team'; comp: string; teamId: string }
  | { kind: 'player'; comp: string; athleteId: string }
  | { kind: 'news'; scope: NewsScope };
```

- [ ] **Step 4: Add the `parseNews` helper and hook it into `parseRoute`**

In `src/utils/router.ts`, add above `parseRoute`:

```ts
// News is cross-competition (no comp prefix). Parse the segments AFTER `news`.
function parseNews(seg: string[]): Route {
  if (seg.length === 0) return { kind: 'news', scope: { by: 'all' } };
  if (seg[0] === 'league' && seg[1]) {
    const league = safeDecode(seg[1]);
    if (league) return { kind: 'news', scope: { by: 'league', league } };
  } else if (seg[0] === 'team' && seg[1]) {
    const team = safeDecode(seg[1]);
    if (team) return { kind: 'news', scope: { by: 'team', team } };
  } else if (seg.length === 1) {
    const sport = safeDecode(seg[0]!);
    if (sport) return { kind: 'news', scope: { by: 'sport', sport } };
  }
  return { kind: 'news', scope: { by: 'all' } };
}
```

Then in `parseRoute`, add the news check BEFORE the competition check:

```ts
export function parseRoute(pathname: string): Route {
  const path = pathname.split('?')[0]?.replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);
  if (seg[0] === 'news') return parseNews(seg.slice(1));
  if (seg.length > 0 && Object.hasOwn(COMPETITIONS, seg[0]!)) {
    return parseView(seg[0]!, seg.slice(1));
  }
  return parseView(DEFAULT_COMPETITION, seg);
}
```

- [ ] **Step 5: Add the `news` case to `pathFor`**

In `src/utils/router.ts`, `pathFor` currently switches on `route.kind` with a `prefix` built from `route.comp`. The `news` kind has no `comp`, so handle it FIRST, before building `prefix`:

```ts
export function pathFor(route: Route): string {
  if (route.kind === 'news') {
    const s = route.scope;
    if (s.by === 'sport') return `/news/${encodeURIComponent(s.sport)}`;
    if (s.by === 'league') return `/news/league/${encodeURIComponent(s.league)}`;
    if (s.by === 'team') return `/news/team/${encodeURIComponent(s.team)}`;
    return '/news';
  }
  const prefix = `/${route.comp}`;
  switch (route.kind) {
    case 'section':
      return `${prefix}${SECTION_SUFFIX[route.section]}`;
    case 'match':
      return `${prefix}/match/${encodeURIComponent(route.slug)}`;
    case 'team':
      return `${prefix}/team/${encodeURIComponent(route.teamId)}`;
    case 'player':
      return `${prefix}/player/${encodeURIComponent(route.athleteId)}`;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/utils/router.test.tsx`
Expected: PASS (new news tests + all existing router tests). `canonicalPath` needs no change — it composes `pathFor(parseRoute(...))`, which now round-trips news paths to themselves (no redirect loop).

- [ ] **Step 7: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean. (`tsc` will flag any unhandled `news` kind elsewhere — there is none yet; App is wired in Task 5.)

```bash
git add src/utils/router.ts src/utils/router.test.tsx
git commit -m "feat(news): comp-less /news route kind (all/sport/league/team)"
```

---

### Task 3: `useNews(scope)` hook

**Files:**
- Create: `src/hooks/useNews.ts`
- Test: `src/hooks/useNews.test.ts`

**Interfaces:**
- Consumes (Task 1): `NewsItem`, `NewsScope` from `../types`; `parseNewsFeed` from `../newsFeed`.
- Produces: `useNews(scope: NewsScope): { items: NewsItem[]; loading: boolean; error: string | null; refetch: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useNews.test.ts` (mirrors `useLeaders.test.ts` conventions):

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNews } from './useNews';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const feed = {
  headlines: [
    {
      id: 1,
      headline: 'Hello',
      description: 'd',
      published: '2026-07-07T00:00:00Z',
      byline: 'ESPN',
      images: [],
      links: { web: { href: 'https://espn.com/1' } },
      categories: [],
    },
  ],
};

describe('useNews', () => {
  it('fetches /api/news for the all scope and exposes parsed items', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => feed });
    const { result } = renderHook(() => useNews({ by: 'all' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/news', expect.any(Object));
    expect(result.current.items[0].headline).toBe('Hello');
    expect(result.current.error).toBeNull();
  });

  it('builds the query for sport/league/team scopes', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ headlines: [] }) });
    renderHook(() => useNews({ by: 'league', league: 'nba' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/news?leagues=nba', expect.any(Object)));
  });

  it('sets an error when the response is not ok and there is no cache', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const { result } = renderHook(() => useNews({ by: 'sport', sport: 'soccer' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load news');
    expect(result.current.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/hooks/useNews.test.ts`
Expected: FAIL — `Failed to resolve import "./useNews"`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useNews.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseNewsFeed } from '../newsFeed';
import type { NewsItem, NewsScope } from '../types';

// The /api/news query for a scope. /api/news filters by sport/leagues/team;
// the 'all' scope sends no filter. (leagues is plural — Phase-1 whitelist.)
function scopeToQuery(s: NewsScope): string {
  if (s.by === 'sport') return `?sport=${encodeURIComponent(s.sport)}`;
  if (s.by === 'league') return `?leagues=${encodeURIComponent(s.league)}`;
  if (s.by === 'team') return `?team=${encodeURIComponent(s.team)}`;
  return '';
}

// News feed for the current scope. Same SWR + visibility-gated polling +
// AbortController idiom as useLeaders; news changes moderately, so poll 120s
// (matches the Worker's global-news fresh window). Resets cache when the scope
// changes so one scope's feed never flashes on another.
export function useNews(scope: NewsScope) {
  const query = scopeToQuery(scope);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: NewsItem[]; ts: number } | null>(null);
  const initialRef = useRef(true);
  const queryRef = useRef(query);

  const fetchData = useCallback(async () => {
    if (queryRef.current !== query) {
      queryRef.current = query;
      cacheRef.current = null;
      initialRef.current = true;
      setItems([]);
    }
    if (cacheRef.current && !initialRef.current) {
      setItems(cacheRef.current.data);
      setLoading(false);
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    if (initialRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch(`/api/news${query}`, { signal });
      if (signal.aborted) return;
      if (!res.ok) throw new Error('Failed to load news');
      const json = await res.json();
      if (signal.aborted) return;
      const data = parseNewsFeed(json);
      cacheRef.current = { data, ts: Date.now() };
      initialRef.current = false;
      setItems(data);
      setError(null);
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      if (!cacheRef.current) setError('Failed to load news');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    fetchData();
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 120_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      abortRef.current?.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchData]);

  return { items, loading, error, refetch: fetchData };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/hooks/useNews.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

```bash
git add src/hooks/useNews.ts src/hooks/useNews.test.ts
git commit -m "feat(news): useNews SWR hook (visibility-gated 120s polling)"
```

---

### Task 4: `NewsView` container page

**Files:**
- Create: `src/components/NewsView.tsx`
- Test: `src/components/NewsView.test.tsx`

**Interfaces:**
- Consumes: `useNews` (Task 3), `NEWS_NAV` (Task 1), `NewsScope`/`NewsItem`/`NewsTag` types, `pathFor`/`navigate` (router, incl. Task 2 news kind), `useT` (i18n).
- Produces: `export default function NewsView({ scope }: { scope: NewsScope })`.

- [ ] **Step 1: Write the failing test**

Create `src/components/NewsView.test.tsx`:

```ts
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import NewsView from './NewsView';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const feed = {
  headlines: [
    {
      id: 7,
      headline: 'Big trade',
      description: 'A summary',
      published: '2026-07-07T00:00:00Z',
      byline: 'ESPN',
      images: [{ url: 'https://a.espncdn.com/x.jpg' }],
      links: { web: { href: 'https://www.espn.com/story/7' } },
      categories: [{ type: 'team', description: 'Lakers', team: { abbreviation: 'LAL' } }],
    },
  ],
};

function renderView() {
  return render(
    <LanguageProvider>
      <NewsView scope={{ by: 'all' }} />
    </LanguageProvider>,
  );
}

describe('NewsView', () => {
  it('renders headlines with an external link and the team tag', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => feed });
    renderView();
    await waitFor(() => expect(screen.getByText('Big trade')).toBeInTheDocument());
    const link = screen.getByRole('link', { name: /Big trade/ });
    expect(link).toHaveAttribute('href', 'https://www.espn.com/story/7');
    expect(link).toHaveAttribute('target', '_blank');
    // team tag is a navigation button (clickable), athlete/league would be plain text
    expect(screen.getByRole('button', { name: 'Lakers' })).toBeInTheDocument();
  });

  it('shows the empty message when there are no headlines', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ headlines: [] }) });
    renderView();
    await waitFor(() => expect(screen.getByText('No news right now')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/NewsView.test.tsx`
Expected: FAIL — cannot resolve `./NewsView`.

- [ ] **Step 3: Write the component**

Create `src/components/NewsView.tsx`:

```tsx
import { NEWS_NAV } from '../newsFeed';
import { useT } from '../i18n';
import type { NewsItem, NewsScope, NewsTag } from '../types';
import { navigate, pathFor } from '../utils/router';
import { useNews } from '../hooks/useNews';

export default function NewsView({ scope }: { scope: NewsScope }) {
  const t = useT();
  const { items, loading, error, refetch } = useNews(scope);
  const activePath = pathFor({ kind: 'news', scope });

  return (
    <div className="max-w-6xl mx-auto w-full px-page-x md:px-page-x-md py-page-y">
      {/* Category-nav strip */}
      <nav
        aria-label={t('news.title')}
        className="ds-segmented mb-4 max-w-full overflow-x-auto no-scrollbar"
      >
        {NEWS_NAV.map((item) => {
          const active = pathFor({ kind: 'news', scope: item.scope }) === activePath;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(pathFor({ kind: 'news', scope: item.scope }), { scroll: true })}
              aria-pressed={active}
              className={`whitespace-nowrap ds-seg-tab ${active ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'}`}
            >
              {t(item.labelKey)}
            </button>
          );
        })}
      </nav>

      {loading && items.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">{t('common.loading')}</p>
      ) : error && items.length === 0 ? (
        <div className="py-12 text-center">
          <p className="ds-caption text-live mb-3">{error}</p>
          <button
            type="button"
            onClick={refetch}
            className="px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide rounded-card hover:brightness-110 transition"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">{t('news.empty')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <article className="ds-glass rounded-card shadow-panel overflow-hidden flex flex-col">
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:opacity-95 transition"
      >
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt=""
            className="w-full aspect-video object-cover"
            loading="lazy"
          />
        )}
        <div className="p-3">
          <h3 className="font-display font-semibold text-sm text-chalk leading-snug line-clamp-2">
            {item.headline}
          </h3>
          {item.description && (
            <p className="mt-1 font-body text-xs text-chalkdim line-clamp-2">{item.description}</p>
          )}
          {item.byline && <p className="mt-2 ds-caption text-chalkdim/70">{item.byline}</p>}
        </div>
      </a>
      {item.tags.length > 0 && (
        <div className="px-3 pb-3 flex flex-wrap gap-1.5">
          {item.tags.map((tag, i) => (
            <Tag key={`${tag.kind}:${tag.label}:${i}`} tag={tag} />
          ))}
        </div>
      )}
    </article>
  );
}

// team tags are clickable (→ that team's news feed); athlete/league are labels
// only, because /api/news can't filter on them.
function Tag({ tag }: { tag: NewsTag }) {
  const cls = 'ds-caption rounded-micro px-1.5 py-0.5 bg-white/5';
  if (tag.kind === 'team' && tag.team) {
    return (
      <button
        type="button"
        onClick={() => navigate(pathFor({ kind: 'news', scope: { by: 'team', team: tag.team! } }), { scroll: true })}
        className={`${cls} text-chalk hover:bg-white/10 transition`}
      >
        {tag.label}
      </button>
    );
  }
  return <span className={`${cls} text-chalkdim`}>{tag.label}</span>;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/NewsView.test.tsx`
Expected: PASS (2 tests). If `line-clamp-2` isn't available in this Tailwind setup, the tests don't depend on it — leave it; it degrades to normal wrapping.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

```bash
git add src/components/NewsView.tsx src/components/NewsView.test.tsx
git commit -m "feat(news): NewsView category nav + external-linking cards + team tags"
```

---

### Task 5: Wire-up — App branch, Header entry, i18n keys

**Files:**
- Modify: `src/i18n/messages.ts` (add `news.*` keys to all 4 languages)
- Modify: `src/App.tsx` (render `NewsView` for the news route; keep `useCompetition` hook stable)
- Modify: `src/components/Header.tsx` (add a cross-comp "News" entry)

**Interfaces:**
- Consumes: `NewsView` (Task 4), the `news` route kind (Task 2).
- Produces: `/news` reachable from the Header and rendered by App.

- [ ] **Step 1: Add i18n keys (all four languages)**

In `src/i18n/messages.ts`, add these keys to the `en`, `zh`, `ja`, and `ko` dicts (place them near the other `nav.*`/`fixtures.*` keys). Use these exact translations:

en:
```ts
  'news.title': 'News',
  'news.all': 'All',
  'news.soccer': 'Soccer',
  'news.basketball': 'Basketball',
  'news.nba': 'NBA',
  'news.eng1': 'Premier League',
  'news.empty': 'No news right now',
```
zh:
```ts
  'news.title': '新闻',
  'news.all': '全部',
  'news.soccer': '足球',
  'news.basketball': '篮球',
  'news.nba': 'NBA',
  'news.eng1': '英超',
  'news.empty': '暂无新闻',
```
ja:
```ts
  'news.title': 'ニュース',
  'news.all': 'すべて',
  'news.soccer': 'サッカー',
  'news.basketball': 'バスケ',
  'news.nba': 'NBA',
  'news.eng1': 'プレミアリーグ',
  'news.empty': 'ニュースはありません',
```
ko:
```ts
  'news.title': '뉴스',
  'news.all': '전체',
  'news.soccer': '축구',
  'news.basketball': '농구',
  'news.nba': 'NBA',
  'news.eng1': '프리미어리그',
  'news.empty': '뉴스가 없습니다',
```

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run src/i18n/messages.test.ts`
Expected: PASS (all `news.*` keys present in every language — a missing one fails parity).

- [ ] **Step 3: Wire the App branch**

In `src/App.tsx`:

1. Add the import (with the other component imports at the top):
```ts
import NewsView from './components/NewsView';
```
2. `App` calls `useCompetition(route.comp)` unconditionally, but the `news` route has no `comp`. Keep the hook call stable by falling back to the default competition for news (the fetched WC data is simply unused on the news page). Change the hook line:
```ts
import { COMPETITIONS, DEFAULT_COMPETITION } from './competitions';
```
```ts
  const { route } = useRouter();
  const dataComp = route.kind === 'news' ? DEFAULT_COMPETITION : route.comp;
  const wc = useCompetition(dataComp);
```
   (Leave the rest of the WC-dependent code using `route.comp` where a comp is guaranteed — those branches only run for non-news routes. `backHome` uses `route.comp`; guard it: `const homeComp = route.kind === 'news' ? DEFAULT_COMPETITION : route.comp;` and use `homeComp` inside `backHome`, with `route.comp` removed from its dep array in favor of `homeComp` — or simply reference `dataComp`.)
3. Add the news branch as the FIRST `if` in the content selection (it doesn't depend on `wc`):
```ts
  let content: ReactNode;
  if (route.kind === 'news') {
    content = <NewsView scope={route.scope} />;
  } else if (route.kind === 'section') {
    // …existing…
```
4. Show the Footer on news pages too (they're top-level list pages like sections):
```ts
      {(route.kind === 'section' || route.kind === 'news') && <Footer />}
```

- [ ] **Step 4: Add the Header entry**

In `src/components/Header.tsx`, add a cross-comp News link. After the section `<nav>` block (the `<div className="order-3 …">…</div>`), the tabs are comp-scoped; News is not. Add a `route.kind` check and a News button inside the same segmented nav so it sits with the tabs. Concretely, inside the `<nav aria-label={t('nav.mainLabel')} …>`, after the `{visibleTabs.map(…)}` block, append:

```tsx
              <button
                type="button"
                onClick={() => navigate(pathFor({ kind: 'news', scope: { by: 'all' } }))}
                aria-pressed={route.kind === 'news'}
                className={`whitespace-nowrap ds-seg-tab ${
                  route.kind === 'news' ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'
                }`}
              >
                {t('news.title')}
              </button>
```

`route` is already in scope (`const { route } = useRouter();` at the top of `Header`). `navigate` and `pathFor` are already imported.

- [ ] **Step 5: Verify the whole feature**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: typecheck clean, lint clean, full suite green.

Then manually smoke it:
```bash
npm run dev
# in another shell (use the printed port, default 5173):
```
- Open `http://localhost:5173/news` → news cards render; the "News" tab is active in the header.
- Click a category chip (e.g. NBA) → URL becomes `/news/league/nba`, feed updates.
- Click a team Tag on a card → URL becomes `/news/team/<abbrev>`, feed updates.
- Click a card → opens the espn.com article in a new tab.
Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/messages.ts src/App.tsx src/components/Header.tsx
git commit -m "feat(news): wire /news into App + Header entry + i18n (4 langs)"
```

---

## Self-Review

**1. Spec coverage (PRD Phase 2 roadmap + §2.2–2.4, §3.2):**
- `/news/:sport` and `/news/league/:league` routes → Task 2 (plus `/news` global and `/news/team/:abbrev` for the Tag target chosen with the user) ✓
- News classification display panel (front-end, outside FixturesView) → Task 4 `NewsView` + Task 5 App branch ✓
- Parse `categories` into team/player Tags → Task 1 `tagsFrom` ✓
- Team-specific news aggregation ("球队专属页新闻聚合") → team Tag → `/news/team/<abbrev>` scope → `useNews` team query ✓ (athlete/league Tags render as labels — `/api/news` has no athlete filter and no league-slug for arbitrary league categories; documented in Global Constraints and the Tag component)
- External article link (no in-app reader — deferred to Phase 3 per the user) → `NewsCard` `target="_blank"` ✓
- 4-language support → Task 5 i18n keys + parity test ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every step carries real code and exact commands. The one conditional instruction (Task 1 Step 5 `link` fallback, Task 4 Step 4 `line-clamp` note) names the exact alternative code.

**3. Type consistency:** `NewsScope`, `NewsTag`, `NewsItem` defined in Task 1 (`src/types`), consumed with identical shapes in Tasks 2–5. `parseNewsFeed`/`NEWS_NAV` (Task 1) used in Tasks 3/4. `useNews(scope)` returns `{ items, loading, error, refetch }` (Task 3), consumed exactly so in Task 4. `Route` gains `{ kind:'news'; scope:NewsScope }` (Task 2), matched in Task 5's App branch and Header check. Route paths produced by `pathFor` (Task 2) are the ones `navigate` is called with in Task 4/5.

**Deferred (later phases, not gaps):** in-app article reader + smart data-linking cards (Phase 3); auth/rate-limiting on `/api/news` (Cloudflare WAF, tracked from Phase 1); athlete/league Tag click-through (needs API support that doesn't exist today).
```
