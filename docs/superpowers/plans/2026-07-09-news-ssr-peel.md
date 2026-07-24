# News SSR Peel (Migration Plan 3 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up real Astro SSR pages for the four news routes — `/news`, `/news/:sport`, `/news/league/:slug`, `/news/team/:abbrev` — so direct visits (and refreshes) get first-paint HTML with the news cards, tab nav, and `<a href>` links visible without JS. Each page fetches news server-side through the unified data layer (`src/data/api.ts`) and mounts the existing `<NewsView>` as a `client:only` island for interactivity, seeded with the SSR data so it skips the first fetch.

**Architecture:** Astro's file-based routing — more specific wins over `[...all].astro` — so the four new pages take over the news URLs from the catch-all SPA. The SPA still mounts the catch-all for every other route, and its in-app `navigate('/news/...')` still works (in-SPA nav to news stays SPA-rendered for now; the peel delivers SSR for direct visits, the SEO-critical case). A single `NewsPageShell.astro` carries the shared SSR chrome (page title + tab nav + cards) used by all four pages. A new `fetchNewsItems` helper in `src/data/api.ts` composes `serveNews` + `parseNewsFeed` so the four pages share one data-fetch path.

**Tech Stack:** Astro 5, @astrojs/cloudflare, React 18, TypeScript, Vitest, npm. No new dependencies.

## Global Constraints

- **The catch-all SPA still works for every non-news route.** The peel must not change `[...all].astro` or `AppIsland.tsx` or `App.tsx`. Only the four news URLs leave the SPA.
- **No client navigation regression.** The existing in-app `navigate('/news/...')` path (via the SPA's `useRouter` → `<NewsView>`) keeps working — `NewsView` still fetches `/api/news?...` and renders client-side. The peel is additive: it adds a NEW SSR path for direct visits; it does NOT replace the SPA path.
- **`NewsView` and `useNews` are minimally modified** to accept `initialData` (so the island skips its first fetch). No other behavior change. The existing `NewsView.test.tsx` (button onClick for team tags, `<a>` for external links) keeps passing unchanged.
- **No `useRouter`/`Header`/`Footer`/i18n refactor.** The island is `client:only="react"` so none of those run server-side. The Astro page renders its own minimal SSR chrome (page title + tab nav + cards); the island's React tree is its own concern.
- **All 349 existing tests must stay green.** Add at least one new test covering `useNews` accepting `initialData` (skips first fetch). The new test is the only addition.
- **Astro build must stay green.** The 4 new `.astro` files compile under `tsconfig.json` and emit the existing `_worker.js`.
- **The live smoke (SPA `/fifa.world` + `/api/*` + 4 news SSR routes) must all work.**

## File Structure

- Modify: `src/hooks/useNews.ts` — accept optional `initialData: NewsItem[]`
- Modify: `src/components/NewsView.tsx` — accept optional `initialData` prop, forward to `useNews`
- Modify: `src/hooks/useNews.test.ts` — add one test for the new param
- Modify: `src/data/api.ts` — add `fetchNewsItems(params, env, ctx)` helper (composes `serveNews` + `parseNewsFeed`)
- Create: `src/components/NewsPageShell.astro` — shared SSR chrome (page title + tab nav with `<a href>` + news cards grid)
- Create: `src/pages/news/index.astro` — `/news`
- Create: `src/pages/news/[sport].astro` — `/news/:sport`
- Create: `src/pages/news/league/[slug].astro` — `/news/league/:slug`
- Create: `src/pages/news/team/[abbrev].astro` — `/news/team/:abbrev`
- Keep untouched: `src/pages/[...all].astro`, `src/components/AppIsland.tsx`, `src/App.tsx`, `src/utils/router.ts`, `src/components/Header.tsx`, `src/components/Footer.tsx`, `src/hooks/useCompetition.ts`, `src/hooks/useMatchDetail.ts`, `src/hooks/useLeaders.ts`, `src/hooks/useStreams.ts`, `src/adapters/*`, `src/i18n/*`, `src/theme/*`, `src/newsFeed.ts` (just the parseNewsFeed + NEWS_NAV exports are consumed; no source change), `src/news.ts`, `src/competitions.ts`, `src/leaders.ts`, `src/types/*`, `src/utils/*`, `src/data/bracketSeeding.ts`, all other components, `worker/index.ts`, `astro.config.mjs`, `tsconfig.json`, `tsconfig.worker.json`, `wrangler.jsonc`, `vitest.config.ts`, `package.json`, `docs/superpowers/**`.

---

### Task 1: `useNews` + `NewsView` accept `initialData`; new helper in `src/data/api.ts`

**Files:**
- Modify: `src/hooks/useNews.ts`
- Modify: `src/components/NewsView.tsx`
- Modify: `src/hooks/useNews.test.ts`
- Modify: `src/data/api.ts`

**Interfaces:**
- `useNews(scope, initialData?)`: when `initialData` is provided AND non-empty, seed `items` with it, set `loading=false`, `error=null`, and skip the first `fetchData` on mount (the polling interval still starts so the island refreshes in-session). When `initialData` is `undefined` or empty, the existing behavior is unchanged (fetch on mount, etc.). For consistency, a provided-but-empty `initialData` is treated the same as no `initialData` (the upstream might have an empty feed for that scope, in which case we still want to poll and confirm).
- `NewsView({ scope, initialData? })`: forwards `initialData` to `useNews`. All other behavior is unchanged.
- `fetchNewsItems(params: NewsParams, env: Env, ctx: ExecutionContext): Promise<NewsItem[]>` in `src/data/api.ts`: calls `serveNews(...)` with the params built into a `URLSearchParams`, reads the response body, runs `parseNewsFeed` (imported from `../newsFeed`), and returns the items. Returns `[]` on non-ok status, parse error, or upstream `{"error":...}` payload. Pure SSR composition — no caching concerns beyond what `serveNews` already does.

- [ ] **Step 1: Add `initialData` to `useNews`**

Replace the signature `export function useNews(scope: NewsScope)` with:

```ts
export function useNews(
  scope: NewsScope,
  initialData?: NewsItem[],
) {
```

…and seed the initial state. The exact change inside the function body, replacing the existing `useState` and `useRef` initializers:

```ts
  const seeded = !!initialData && initialData.length > 0;
  const [items, setItems] = useState<NewsItem[]>(initialData ?? []);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: NewsItem[]; ts: number } | null>(
    seeded ? { data: initialData, ts: Date.now() } : null,
  );
  const initialRef = useRef(!seeded);
```

Then in the existing `useEffect` that calls `fetchData()` on mount, gate the initial call so it doesn't fire when seeded:

```ts
  useEffect(() => {
    if (!initialRef.current) {
      // already seeded with initialData; skip the first fetch and start polling
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
    }
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
```

(The two branches above are identical except the first one skips the initial `fetchData()` call. They are split because a separate `if (initialRef.current)` flag controls behavior; the rest is the same. Do not refactor into one branch — keeping the literal `if (!initialRef.current)` early-return pattern makes the SSR-skip intent obvious at the call site.)

- [ ] **Step 2: Forward `initialData` from `NewsView`**

Edit `src/components/NewsView.tsx`:

Change the function signature:
```ts
export default function NewsView({ scope, initialData }: { scope: NewsScope; initialData?: NewsItem[] }) {
```

Change the `useNews` call:
```ts
  const { items, loading, error, refetch } = useNews(scope, initialData);
```

That's the entire NewsView change. Do not touch the nav (still uses `navigate()` + button onClick), do not touch the card rendering, do not touch the i18n imports.

- [ ] **Step 3: Add a `useNews` test for the `initialData` skip-first-fetch behavior**

Add the following test to `src/hooks/useNews.test.ts` (do not change the existing tests):

```ts
  it('skips the first fetch when initialData is provided and non-empty', async () => {
    const seed: NewsItem[] = [
      {
        id: 'seed-1',
        headline: 'Seeded headline',
        description: 'd',
        published: '2026-07-07T00:00:00Z',
        byline: 'ESPN',
        imageUrl: '',
        link: 'https://espn.com/seed',
        tags: [],
      },
    ];
    const { result } = renderHook(() => useNews({ by: 'all' }, seed));
    // synchronous: the seeded state is visible without waiting for any fetch
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual(seed);
    expect(result.current.error).toBeNull();
    // wait one tick for any effect to settle; the fetch must NOT have happened
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

You'll also need to add an import at the top of the test file:
```ts
import type { NewsItem } from '../types';
```

(Do not add any other imports — the existing `useNews` import path is `./useNews` and stays as-is.)

- [ ] **Step 4: Add `fetchNewsItems` to `src/data/api.ts`**

Add the following imports at the top of `src/data/api.ts` (next to the existing `../news` import):
```ts
import { parseNewsFeed } from '../newsFeed';
import type { NewsItem } from '../types';
import type { NewsParams } from '../news';
```

(Re-uses the `NewsParams` type from `../news` — already imported as a type via the existing `newsParamsFromQuery` import? No, the existing import is just the function. So `import type { NewsParams } from '../news';` is the right new line. Do not change the existing value import.)

Then add this function at the end of `src/data/api.ts` (after `serveNews`):

```ts
// Compose serveNews + parseNewsFeed into one SSR-friendly call. Returns the
// already-parsed NewsItem[] ready to render. Empty array on any failure
// (non-ok, JSON error, upstream {"error":...}). Used by the Astro news pages.
export async function fetchNewsItems(
  params: NewsParams,
  env: Env,
  ctx: ExecutionContext,
): Promise<NewsItem[]> {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.sport) q.set('sport', params.sport);
  if (params.leagues) q.set('leagues', params.leagues);
  if (params.team) q.set('team', params.team);
  const res = await serveNews(q, env, ctx);
  if (!res.ok) return [];
  try {
    const body = await res.text();
    const json: unknown = JSON.parse(body);
    if (obj(json).error) return [];
    return parseNewsFeed(json);
  } catch {
    return [];
  }
}
```

(Add a tiny local helper for the `obj()` coercion — same shape as the one in `src/newsFeed.ts` lines 8–10 — or import the existing one. **Do not** import the one from `newsFeed.ts` because it's not exported there (it's a local function). Add this 3-liner at the top of the function, just before the `serveNews` call, OR just inline the check `if (json && typeof json === 'object' && 'error' in json)`. The inline check is simpler — use that.)

Inline version (preferred, fewer lines):
```ts
export async function fetchNewsItems(
  params: NewsParams,
  env: Env,
  ctx: ExecutionContext,
): Promise<NewsItem[]> {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.sport) q.set('sport', params.sport);
  if (params.leagues) q.set('leagues', params.leagues);
  if (params.team) q.set('team', params.team);
  const res = await serveNews(q, env, ctx);
  if (!res.ok) return [];
  try {
    const body = await res.text();
    const json: unknown = JSON.parse(body);
    if (json && typeof json === 'object' && 'error' in json) return [];
    return parseNewsFeed(json);
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Verify the source compiles and tests pass**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
npx vitest run 2>&1 | tail -10
```

Expected:
- `tsc` (both) exit 0.
- Vitest reports `Test Files  40 passed (40)` and `Tests  350 passed (350)` (349 + 1 new). If the count is off, **stop and report** — that's a real finding.

- [ ] **Step 6: Commit (deferred — see Task 2)**

Per project convention, the commit is at the end of Task 2 once all files have settled. This step intentionally makes no commit.

---

### Task 2: 4 Astro pages + the shared SSR chrome

**Files:**
- Create: `src/components/NewsPageShell.astro`
- Create: `src/pages/news/index.astro`
- Create: `src/pages/news/[sport].astro`
- Create: `src/pages/news/league/[slug].astro`
- Create: `src/pages/news/team/[abbrev].astro`

**Interfaces:**
- All 4 pages do the same work: parse path params into a `NewsScope`, call `fetchNewsItems(scope, env, ctx)` (where `env = Astro.locals.runtime.env` and `ctx = Astro.locals.runtime.ctx`), then render `<NewsPageShell scope={scope} items={items} title="…">…</NewsPageShell>` plus `<NewsView scope={scope} initialData={items} client:only="react" />`. The shell renders the page chrome (page title + tab nav with `<a href>` + card grid) for SEO; the island takes over for interactivity on the client.
- Each page is `prerender = false` (it fetches live data at request time; the data layer's KV cache handles the load).
- No `getStaticPaths` is needed — the dynamic params accept any value at request time. (The shell's tab nav highlights the active scope; an unknown scope still renders a valid page, just with no active tab.)

- [ ] **Step 1: Create `src/components/NewsPageShell.astro`**

The shell renders:
- An `<h1>` for the page title (e.g. "News — Soccer").
- A `<nav>` of 5 tab buttons, each as an `<a href="…">` linking to the relevant path. The active tab gets `aria-current="page"`.
- A grid of news cards, each an `<article>` with `<img>` (if present), headline `<h2>`, description, byline, and tags. External article links are `<a target="_blank" rel="noopener noreferrer">`; team-tag links go to `/news/team/<abbrev>`.

Use this exact content:

```astro
---
import type { NewsItem, NewsScope } from '../types';
import { NEWS_NAV } from '../newsFeed';

// Page title for the current scope.
function scopeTitle(s: NewsScope): string {
  if (s.by === 'all') return 'News';
  if (s.by === 'sport') return `News — ${s.sport}`;
  if (s.by === 'league') return `News — ${s.league}`;
  return `News — team ${s.team}`;
}

// Stable href for each NEWS_NAV item.
function scopeHref(s: NewsScope): string {
  if (s.by === 'all') return '/news';
  if (s.by === 'sport') return `/news/${encodeURIComponent(s.sport)}`;
  if (s.by === 'league') return `/news/league/${encodeURIComponent(s.league)}`;
  return `/news/team/${encodeURIComponent(s.team)}`;
}

// Is the given scope the currently-active one? Strict structural match.
function isActive(current: NewsScope, candidate: NewsScope): boolean {
  if (current.by !== candidate.by) return false;
  if (current.by === 'all') return candidate.by === 'all';
  if (current.by === 'sport') return candidate.by === 'sport' && (current as { sport: string }).sport === (candidate as { sport: string }).sport;
  if (current.by === 'league') return candidate.by === 'league' && (current as { league: string }).league === (candidate as { league: string }).league;
  return candidate.by === 'team' && (current as { team: string }).team === (candidate as { team: string }).team;
}

interface Props {
  scope: NewsScope;
  items: NewsItem[];
  title: string;
}

const { scope, items, title } = Astro.props;
---
<main class="max-w-6xl mx-auto w-full px-page-x md:px-page-x-md py-page-y">
  <h1 class="font-display font-bold text-2xl text-chalk tracking-wide mb-4">{title}</h1>

  <nav
    aria-label="News categories"
    class="ds-segmented mb-4 max-w-full overflow-x-auto no-scrollbar"
  >
    {NEWS_NAV.map((item) => {
      const active = isActive(scope, item.scope);
      return (
        <a
          href={scopeHref(item.scope)}
          aria-current={active ? 'page' : undefined}
          class={`whitespace-nowrap ds-seg-tab ${active ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'}`}
        >
          {item.labelKey}
        </a>
      );
    })}
  </nav>

  {items.length === 0 ? (
    <p class="ds-caption text-chalkdim py-12 text-center">No news right now</p>
  ) : (
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const external = item.link.startsWith('https://');
        return (
          <article class="ds-glass rounded-card shadow-panel overflow-hidden flex flex-col">
            {item.imageUrl && (
              <img src={item.imageUrl} alt="" class="w-full aspect-video object-cover" loading="lazy" />
            )}
            <div class="p-3">
              <h2 class="font-display font-semibold text-sm text-chalk leading-snug line-clamp-2">
                {external ? (
                  <a href={item.link} target="_blank" rel="noopener noreferrer" class="hover:opacity-95">
                    {item.headline}
                  </a>
                ) : (
                  item.headline
                )}
              </h2>
              {item.description && (
                <p class="mt-1 font-body text-xs text-chalkdim line-clamp-2">{item.description}</p>
              )}
              {item.byline && <p class="mt-2 ds-caption text-chalkdim/70">{item.byline}</p>}
            </div>
            {item.tags.length > 0 && (
              <div class="px-3 pb-3 flex flex-wrap gap-1.5">
                {item.tags.map((tag) =>
                  tag.kind === 'team' && tag.team ? (
                    <a
                      href={`/news/team/${encodeURIComponent(tag.team)}`}
                      class="ds-caption rounded-micro px-1.5 py-0.5 bg-white/5 text-chalk hover:bg-white/10 transition"
                    >
                      {tag.label}
                    </a>
                  ) : (
                    <span class="ds-caption rounded-micro px-1.5 py-0.5 bg-white/5 text-chalkdim">
                      {tag.label}
                    </span>
                  )
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  )}
</main>
```

Notes:
- The label keys (`item.labelKey`) are passed through as raw strings in the SSR HTML. The island re-renders them via `t()` for i18n. The SSR HTML therefore shows the i18n key itself (e.g. `news.all`) for a moment before the island swaps in the translated string. This is a known acceptable trade-off for the first peel — the cards (the SEO target) are localized by the island within one paint. A later plan can wire i18n into the Astro shell (via the cookie-based i18n from the design spec §3).
- Tailwind utility class names come from the existing `src/index.css` design system (`.ds-glass`, `.ds-caption`, `.ds-segmented`, `.ds-seg-tab`, `.rounded-card`, `.rounded-micro`, etc.) — no CSS changes needed.
- `<a>` tags for navigation (no `onClick`) — real links, SEO-friendly, browser-handled. Astro's default `<a>` behaviour is a full page navigation; that's the desired behaviour for the first peel.

- [ ] **Step 2: Create the 4 Astro pages**

Each page has the same shape: parse path params into a `NewsScope`, fetch items, render shell + island. The only differences are the path-param parsing and the title.

`src/pages/news/index.astro`:
```astro
---
import Layout from '../../layouts/Layout.astro';
import NewsView from '../../components/NewsView';
import NewsPageShell from '../../components/NewsPageShell.astro';
import { fetchNewsItems } from '../../data/api';
import type { NewsScope } from '../../types';

const scope: NewsScope = { by: 'all' };
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx;
const items = await fetchNewsItems({ limit: 20 }, env, ctx);
---
<Layout title="umuo — News">
  <NewsPageShell scope={scope} items={items} title="News" />
  <NewsView scope={scope} initialData={items} client:only="react" />
</Layout>
```

`src/pages/news/[sport].astro`:
```astro
---
import Layout from '../../layouts/Layout.astro';
import NewsView from '../../components/NewsView';
import NewsPageShell from '../../components/NewsPageShell.astro';
import { fetchNewsItems } from '../../data/api';
import type { NewsScope } from '../../types';

const sport = Astro.params.sport ?? '';
const scope: NewsScope = { by: 'sport', sport };
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx;
const items = await fetchNewsItems({ limit: 20, sport }, env, ctx);
---
<Layout title={`umuo — News — ${sport}`}>
  <NewsPageShell scope={scope} items={items} title={`News — ${sport}`} />
  <NewsView scope={scope} initialData={items} client:only="react" />
</Layout>
```

`src/pages/news/league/[slug].astro`:
```astro
---
import Layout from '../../../layouts/Layout.astro';
import NewsView from '../../../components/NewsView';
import NewsPageShell from '../../../components/NewsPageShell.astro';
import { fetchNewsItems } from '../../../data/api';
import type { NewsScope } from '../../../types';

const league = Astro.params.slug ?? '';
const scope: NewsScope = { by: 'league', league };
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx;
const items = await fetchNewsItems({ limit: 20, leagues: league }, env, ctx);
---
<Layout title={`umuo — News — ${league}`}>
  <NewsPageShell scope={scope} items={items} title={`News — ${league}`} />
  <NewsView scope={scope} initialData={items} client:only="react" />
</Layout>
```

`src/pages/news/team/[abbrev].astro`:
```astro
---
import Layout from '../../../layouts/Layout.astro';
import NewsView from '../../../components/NewsView';
import NewsPageShell from '../../../components/NewsPageShell.astro';
import { fetchNewsItems } from '../../../data/api';
import type { NewsScope } from '../../../types';

const team = Astro.params.abbrev ?? '';
const scope: NewsScope = { by: 'team', team };
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx;
const items = await fetchNewsItems({ limit: 20, team }, env, ctx);
---
<Layout title={`umuo — News — team ${team}`}>
  <NewsPageShell scope={scope} items={items} title={`News — team ${team}`} />
  <NewsView scope={scope} initialData={items} client:only="react" />
</Layout>
```

Notes:
- All four pages are `prerender = false` (the Layout already inherits this from the page itself; Astro pages default to `prerender = false` for SSR mode. The `output: "server"` config from Task 1 of the skeleton plan makes this the default. No explicit declaration needed.)
- `Astro.locals.runtime.env` is typed as the `Env` interface from `env.d.ts` via `App.Locals extends Runtime<Env>`. So passing it directly to `fetchNewsItems` works without a cast.
- The pages use `Layout` from `src/layouts/Layout.astro` (created in the skeleton plan). The Layout carries the head/meta/title; the `title` attribute on `<Layout>` is what gets rendered as the page `<title>` in the head. The skeleton plan's Layout doesn't currently accept a `title` prop — see Step 3 for the small modification.

- [ ] **Step 3: Make `src/layouts/Layout.astro` accept a `title` prop**

Currently the Layout has a hardcoded `<title>umuo — World Cup 2026…</title>`. The news pages need per-page titles. Replace the frontmatter + title tag with:

Frontmatter (replaces the existing `import '../index.css';` line):
```astro
---
import '../index.css';

interface Props {
  title?: string;
}

const { title = 'umuo — World Cup 2026 live streams & fixtures' } = Astro.props;
---
```

Title tag (replace the hardcoded `<title>…</title>` line with):
```astro
    <title>{title}</title>
```

That's the only change to the Layout. The description, OG, Twitter, and other meta stay as they are (they describe the site generally; per-page OG/Twitter is a future enhancement).

- [ ] **Step 4: Verify — build, tests, live smoke**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npm run build
npx vitest run 2>&1 | tail -10
```

Expected:
- Build exit 0. `astro check` 0 errors. `astro build` emits `dist/_worker.js/` + the 4 new page bundles.
- Vitest `Test Files  40 passed (40)` and `Tests  350 passed (350)`.

Live smoke (start dev server, curl 4 news routes + the SPA fallback, kill server):

```bash
npm run dev > /tmp/astro-dev.log 2>&1 &
DEV_PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/ >/dev/null 2>&1 && break
done
echo "--- /news (status + has cards?) ---"
curl -s -o /tmp/news.html -w "%{http_code}\n" "http://localhost:4321/news"
grep -c "ds-glass" /tmp/news.html
echo "--- /news/soccer ---"
curl -s -o /tmp/news-soccer.html -w "%{http_code}\n" "http://localhost:4321/news/soccer"
grep -c "ds-glass" /tmp/news-soccer.html
echo "--- /news/league/nba ---"
curl -s -o /tmp/news-nba.html -w "%{http_code}\n" "http://localhost:4321/news/league/nba"
grep -c "ds-glass" /tmp/news-nba.html
echo "--- /news/team/lal ---"
curl -s -o /tmp/news-lal.html -w "%{http_code}\n" "http://localhost:4321/news/team/lal"
grep -c "ds-glass" /tmp/news-lal.html
echo "--- /news: tab nav <a href> check ---"
grep -oE 'href="/news(/[^"]*)?"' /tmp/news.html | sort -u
echo "--- /news: island placeholder check ---"
grep -c "astro-island" /tmp/news.html
echo "--- /fifa.world (catch-all SPA must still work) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world"
echo "--- /api/fifa.world/scoreboard (worker must still work) ---"
curl -s "http://localhost:4321/api/fifa.world/scoreboard" | head -c 100
echo
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected:
- All 4 news routes return 200.
- Each news page has at least one `ds-glass` match (news card rendered SSR) AND at least one `astro-island` placeholder (the island will mount).
- The tab nav has `<a href="/news">` (or `/news/<x>`) — confirming real links.
- `/fifa.world` returns 200 (catch-all SPA still resolves).
- `/api/fifa.world/scoreboard` returns JSON (worker still works).

If any check fails, **stop and report** — that's a real finding.

- [ ] **Step 5: Commit**

```bash
cd /Users/youming/GitHub/youming-ai/cup
git add src/hooks/useNews.ts src/hooks/useNews.test.ts src/components/NewsView.tsx src/data/api.ts src/components/NewsPageShell.astro src/layouts/Layout.astro src/pages/news/
git commit -m "feat(news): peel /news routes into Astro SSR with initialData island

The four news routes (/news, /news/:sport, /news/league/:slug, /news/team/:abbrev)
are now real Astro pages. Each fetches via the unified data layer
(fetchNewsItems → serveNews + parseNewsFeed) on the server, renders first-paint
HTML (page title + tab nav with <a href> + card grid), and mounts <NewsView>
as a client:only island seeded with the SSR data via initialData (so the
island skips its first fetch and starts polling from the same items).

useNews now accepts an optional initialData param: when provided and non-empty,
it seeds the state and skips the initial mount-fetch. Polling still runs.
This is the only change to the client island — NewsView's nav still uses
navigate() and its team tags are still buttons, so in-SPA nav to /news
(e.g. via the Header's 'News' tab) keeps working through the SPA's
useRouter → NewsView path; the SSR path is additive for direct visits and
refreshes (the SEO-critical case).

The catch-all [...all].astro still resolves every non-news route via the SPA.
The four new .astro pages take the news URLs by Astro's more-specific-wins
routing. Header/Footer/i18n providers stay in the island (client:only) — the
Astro page renders its own minimal SSR chrome (page title, tab nav, cards).

A shared NewsPageShell.astro carries the SSR chrome used by all four pages.
Layout.astro now accepts a title prop so the news pages can override the
default site title for the <title> tag. Per-page OG/Twitter meta stays a
future enhancement.

fetchNewsItems composes serveNews (already shared via the unified data
layer) with parseNewsFeed, returning a ready-to-render NewsItem[] and
[] on any failure path. No new data-layer primitives introduced."
```

---

## Self-Review

**1. Spec coverage (design §4 step 3 "Peel pages into SSR, news first"):**
- News routes peeled (`/news`, `/news/:sport`, `/news/league/:slug`, `/news/team/:abbrev`) → Task 2 ✓
- Each renders first paint server-side → Task 2 Step 1 (NewsPageShell) + Step 2 (4 pages) ✓
- Interactive view becomes an island → Task 2 Step 2 (`<NewsView client:only="react">`) ✓
- Hooks gain `initialData` → Task 1 Step 1 (`useNews`) + Step 2 (NewsView forwards) ✓
- Unified data layer shared → Task 1 Step 4 (`fetchNewsItems` in `src/data/api.ts`) ✓
- Site runs uninterrupted (catch-all still handles non-news) → Task 2 Step 4 smoke check ✓

**2. Placeholder scan:** No TBD/TODO. File contents given in full. The known trade-off (SSR HTML shows raw i18n keys for tab labels until the island hydrates) is documented in the shell's notes — it's a known acceptable trade-off for the first peel, not a vague placeholder.

**3. Type/interface consistency:**
- `useNews(scope, initialData?)` — `initialData` is optional. Existing callers that pass just `scope` (the `NewsView` test, the SPA's `App.tsx`) keep working without changes. ✓
- `NewsView({ scope, initialData? })` — new optional prop. Existing test still passes (`<NewsView scope={...} />` with no `initialData`). ✓
- `fetchNewsItems(params: NewsParams, env: Env, ctx: ExecutionContext)` — matches the existing `serveNews` signature's `env`/`ctx` types from `src/data/api.ts`. ✓
- The 4 Astro pages all use `Astro.locals.runtime.env` and `Astro.locals.runtime.ctx` — typed via `env.d.ts`'s `App.Locals extends Runtime<Env>`. No cast needed. ✓
- `<Layout title="…">` — the new `Props.title` is optional with a default, so the existing `[...all].astro` (which uses `<Layout>` with no `title`) keeps working without changes. ✓

**Note on risk:** This is the FIRST per-page peel. The new pattern is "Astro page + island + initialData" and it's validated end-to-end here. The known unknowns — (a) `useNews` initialData skipping the first fetch but not breaking polling, (b) `client:only` on NewsView not causing hydration mismatches, (c) Astro catching the four news routes before the catch-all, (d) the data-layer helper composing serveNews + parseNewsFeed correctly — all have explicit verification (Task 1 Step 5, Task 2 Step 4). If anything surfaces a regression, that's a real finding to fix in this plan, not paper over.
