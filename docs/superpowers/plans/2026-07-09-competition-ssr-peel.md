# Competition Pages SSR Peel (Migration Plan 4 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up real Astro SSR pages for the three competition routes — `/:comp`, `/:comp/scorers`, `/:comp/bracket` — so direct visits get server-rendered first paint with the page title, the matches/standings/bracket payload validated, and the React view mounted as a `client:only` island seeded with the SSR data. The `/:comp` is the biggest SEO/content surface so far; the bracket page is the smallest. Same shape as the news peel (Plan 3): server-side data fetch via the unified data layer → Astro shell → island takes over for interactivity + polling.

**Architecture:** Three new Astro pages (`src/pages/[comp]/index.astro`, `src/pages/[comp]/scorers.astro`, `src/pages/[comp]/bracket.astro`) take over the three competition URLs from the catch-all SPA via Astro's more-specific-wins routing. A new `src/components/CompetitionIsland.tsx` wraps `<FixturesView>` and wires the two polling hooks (`useCompetition` + `useLeaders`) to the SSR-fetched seed data, so the island can skip its first fetch and start polling right where the server left off. Two new server-side helpers in `src/data/api.ts` (`getCompetitionView` and `getPipelineLeaders`) compose the existing `serve*` functions + sport adapter / `assembleLeaders` into ready-to-render payloads.

**Tech Stack:** Astro 5, @astrojs/cloudflare, React 18, TypeScript, Vitest, npm. No new dependencies.

## Global Constraints

- **Catch-all SPA still works for every non-competition route.** The peel must not change `[...all].astro`, `AppIsland.tsx`, or `App.tsx`. Only `/:comp`, `/:comp/scorers`, `/:comp/bracket` leave the SPA. The in-SPA `navigate('/<comp>...')` path still works (SPA renders `<FixturesView>` the old way for in-app nav; the SSR path is additive for direct visits / refreshes — the SEO-critical case).
- **No `useRouter` / `useStreams` / `Header` / `Footer` / i18n refactor.** The island is `client:only="react"` so none of those run server-side. The Astro page renders a minimal SSR shell (page title + the Layout); the island's React tree is its own concern.
- **`useCompetition` and `useLeaders` are minimally modified** to accept an optional `initialData` parameter (so the island skips its first fetch). No other behavior change. Existing tests keep passing.
- **`FixturesView` is NOT modified** (beyond the new island wrapper passing the same props the SPA's `App.tsx` already passes). The island's wrapper handles the `useCompetition` + `useLeaders` calls — FixturesView stays pure-presentation.
- **Streams stay browser-side only.** The ppv.st endpoint fingerprint-blocks datacenter requests (per `useStreams`), so the SSR pass cannot compute `watchableSlugs`. The island computes them after mount; the SSR HTML renders cards without the watchable indicator (which appears once the island hydrates — brief flash, acceptable for the first peel).
- **Validation is strict.** Each Astro page validates `Astro.params.comp` against the `COMPETITIONS` registry; unknown comp → Astro 404 (or a `new Response('Not found', { status: 404 })` return from the frontmatter). Never falls through to the catch-all.
- **All 350 existing tests must stay green.** Add at least two new tests — one for `useCompetition(initialData)` skip-first-fetch, one for `useLeaders(initialData)` skip-first-fetch. The new tests are the only additions.
- **Astro build must stay green.** The 3 new `.astro` files + the new `CompetitionIsland.tsx` compile under `tsconfig.json` and emit the existing `_worker.js`.
- **The live smoke (SPA `/fifa.world` + `/api/*` + 3 competition SSR routes + 4 news SSR routes from Plan 3) must all work.**

## File Structure

- Modify: `src/hooks/useCompetition.ts` — accept optional `initialData: { matches, standings, scorers }`
- Modify: `src/hooks/useLeaders.ts` — accept optional `initialData: Leader[]`
- Modify: `src/hooks/useCompetition.test.ts` — add one test for `initialData` skip-first-fetch
- Modify: `src/hooks/useLeaders.test.ts` — add one test for `initialData` skip-first-fetch
- Modify: `src/data/api.ts` — add `getCompetitionView(comp, env, ctx)` and `getPipelineLeaders(comp, env, ctx)` helpers
- Create: `src/components/CompetitionIsland.tsx` — wraps `<FixturesView>`, calls `useCompetition` + `useLeaders` with `initialData`
- Create: `src/pages/[comp]/index.astro` — `/:comp` (matches section)
- Create: `src/pages/[comp]/scorers.astro` — `/:comp/scorers`
- Create: `src/pages/[comp]/bracket.astro` — `/:comp/bracket`
- Keep untouched: `src/pages/[...all].astro`, `src/components/AppIsland.tsx`, `src/App.tsx`, `src/components/FixturesView.tsx`, `src/components/BracketView.tsx`, `src/components/LeadersView.tsx`, `src/components/Header.tsx`, `src/components/Footer.tsx`, `src/components/NewsView.tsx`, `src/components/NewsPageShell.astro`, `src/components/NewsIsland.tsx` (not yet created), `src/utils/router.ts`, `src/hooks/useNews.ts`, `src/hooks/useStreams.ts`, `src/hooks/useMatchDetail.ts`, `src/hooks/useBracket.ts`, `src/adapters/*`, `src/i18n/*`, `src/theme/*`, `src/newsFeed.ts`, `src/news.ts`, `src/competitions.ts`, `src/leaders.ts`, `src/types/*`, `src/utils/*`, `src/data/bracketSeeding.ts`, `src/pages/news/**` (created in Plan 3, still works), `src/layouts/Layout.astro` (modified in Plan 3, no further change), `worker/index.ts`, `astro.config.mjs`, `tsconfig.json`, `tsconfig.worker.json`, `wrangler.jsonc`, `vitest.config.ts`, `package.json`, `docs/superpowers/**`.

---

### Task 1: `useCompetition` + `useLeaders` accept `initialData`; two new data-layer helpers

**Files:**
- Modify: `src/hooks/useCompetition.ts`
- Modify: `src/hooks/useLeaders.ts`
- Modify: `src/hooks/useCompetition.test.ts`
- Modify: `src/hooks/useLeaders.test.ts`
- Modify: `src/data/api.ts`

**Interfaces:**
- `useCompetition(comp, initialData?)`: when `initialData` is provided AND non-empty, seed `matches`/`standings`/`scorers` with it, set `loading=false`, `error=null`, and skip the first `fetchAll` on mount. Polling still runs. Mirror of the `useNews` initialData pattern from Plan 3.
- `useLeaders(comp, initialData?)`: same pattern. When `comp` is null (current call sites in `FixturesView` pass null for scoreboard-sourced comps) AND `initialData` is undefined/empty, behavior is unchanged. When `comp` is null AND `initialData` is non-empty, the hook is a no-op (no fetch, just returns the initialData as `leaders`). The pipeline-leaders case where `comp` is a real key is the one the Astro scorers page uses.
- `getCompetitionView(comp, env, ctx)` in `src/data/api.ts`: fetches `serve(comp, 'scoreboard')` + `serve(comp, 'standings')` in parallel, runs the sport adapter (`getAdapter(comp).transform(scoreboard, standings)`) to produce the normalized `{ matches, standings, scorers }`. Returns a safe empty shape on any error path. The adapter import goes through `../adapters` (which exports `getAdapter`).
- `getPipelineLeaders(comp, env, ctx)` in `src/data/api.ts`: runs the leaders-pipeline composition that `serveLeaders` already does (cachedProducer + assembleLeaders), but returns the `Leader[]` directly (no Response wrapping). Returns `[]` on any error path. Implemented by calling the existing `serveLeaders` and reading its body.

- [ ] **Step 1: Add `initialData` to `useCompetition`**

Modify `src/hooks/useCompetition.ts`. Replace the `useState`/`useRef` initializers (the existing `useState<CompMatch[]>([])` etc.) with the seeded versions, mirroring the Plan 3 `useNews` pattern:

```ts
export function useCompetition(
  comp: string,
  initialData?: {
    matches: CompMatch[];
    standings: StandingsData;
    scorers: TopScorer[];
  },
) {
  const BASE = `/api/${comp}`;
  const seeded = !!initialData && initialData.matches.length > 0;
  const [matches, setMatches] = useState<CompMatch[]>(initialData?.matches ?? []);
  const [standings, setStandings] = useState<StandingsData>(
    initialData?.standings ?? { kind: 'soccer', groups: [] },
  );
  const [scorers, setScorers] = useState<TopScorer[]>(initialData?.scorers ?? []);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{
    matches: CompMatch[];
    standings: StandingsData;
    scorers: TopScorer[];
    ts: number;
  } | null>(seeded ? { ...initialData, ts: Date.now() } : null);
  const initialRef = useRef(!seeded);
  const compRef = useRef(comp);
```

(That's the existing 3+ initializers plus a few more for `standings`/`scorers` — preserve the existing types and defaults; only the seed is added.)

In the existing `useEffect` that calls `fetchAll()` on mount, gate the initial call so it doesn't fire when seeded. Use the same two-branch pattern as `useNews` (Plan 3):

```ts
  useEffect(() => {
    if (!initialRef.current) {
      // already seeded with initialData; skip the first fetch and start polling
      const onVisibility = () => {
        if (document.visibilityState === 'visible') fetchAll();
      };
      const id = setInterval(() => {
        if (document.visibilityState === 'visible') fetchAll();
      }, 30_000);
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        abortRef.current?.abort();
        clearInterval(id);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    }
    fetchAll();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchAll();
    };
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchAll();
    }, 30_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      abortRef.current?.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchAll]);
```

Do not change the rest of `useCompetition` (the `fetchAll` body, the SWR-on-cache branch, the comp-change reset, the error handling).

- [ ] **Step 2: Add `initialData` to `useLeaders`**

Modify `src/hooks/useLeaders.ts` with the same pattern. The wrinkle: `useLeaders` accepts `comp: string | null` (null means "skip the fetch entirely" — the scoreboard-sourced-comp case). Seed behavior:

- If `comp` is null AND `initialData` is non-empty → return `initialData` as `leaders`, `loading=false`, `error=null`, never call `fetchData`. (Useful for SPA call sites that already get pipeline leaders from `useCompetition` and pass them through — but in this plan we don't add such a call site, so this is just defensive. Plan for it.)
- If `comp` is a real string AND `initialData` is non-empty → seed state, skip the first fetch (mirror of `useNews`).
- If `comp` is a real string AND `initialData` is undefined/empty → unchanged behavior (fetch on mount, poll).
- If `comp` is null AND `initialData` is undefined/empty → unchanged behavior (return empty, no fetch).

Replace the existing `useState`/`useRef` initializers with:

```ts
  const seeded = !!initialData && initialData.length > 0;
  const [leaders, setLeaders] = useState<Leader[]>(initialData ?? []);
  const [loading, setLoading] = useState(!!comp && !seeded);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: Leader[]; ts: number } | null>(
    seeded ? { data: initialData, ts: Date.now() } : null,
  );
  const initialRef = useRef(!seeded);
  const compRef = useRef<string | null>(comp);
```

In the `useEffect`, gate the initial `fetchData()` the same way as `useNews` and `useCompetition`. Add the `initialData` to the dep array — but the `useEffect` already depends on `[comp, fetchData]`. Add `initialData` to the array so when the SSR seed changes (e.g. user navigates from one comp's island to another's), the new seed takes effect. The dep list becomes `[comp, fetchData, initialData]`. The `fetchData` is already `useCallback`'d with `[comp]` deps, so adding `initialData` to the effect's deps is the explicit signal that the seed changed.

(If you want to be conservative, drop the `initialData` dep — `comp` already changes for a real nav, and the `compRef` reset in `fetchData` handles it. Pick either: keeping `initialData` in the deps makes the intent explicit; dropping it matches the current `useNews` pattern from Plan 3. **Pick: drop `initialData` from the effect deps**, to match `useNews`. The `compRef` reset inside `fetchData` covers real nav cases. Do not add a new dep.)

- [ ] **Step 3: Add the two new tests**

To `src/hooks/useCompetition.test.ts`, add (and add the import for `CompMatch` / `StandingsData` / `TopScorer` at the top of the file if not already present — they are referenced via the hook's existing return type, so likely already imported; if not, add them):

```ts
  it('skips the first fetch when initialData is provided and non-empty', async () => {
    const seed = {
      matches: [
        {
          id: 'seed-1',
          homeName: 'A',
          awayName: 'B',
          homeFlag: '',
          awayFlag: '',
          homeId: '1',
          awayId: '2',
          homeScore: 0,
          awayScore: 0,
          kickoff: null,
          status: 'upcoming' as const,
          homeScorers: [],
          awayScorers: [],
          venue: '',
          slug: 'a-vs-b',
        },
      ],
      standings: { kind: 'soccer' as const, groups: [] },
      scorers: [],
    };
    const { result } = renderHook(() => useCompetition('fifa.world', seed));
    // synchronous: the seeded state is visible without waiting for any fetch
    expect(result.current.loading).toBe(false);
    expect(result.current.matches).toEqual(seed.matches);
    expect(result.current.standings).toEqual(seed.standings);
    expect(result.current.scorers).toEqual(seed.scorers);
    expect(result.current.error).toBeNull();
    // wait one tick for any effect to settle; the fetch must NOT have happened
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

To `src/hooks/useLeaders.test.ts`, add:

```ts
  it('skips the first fetch when initialData is provided and non-empty', async () => {
    const seed: Leader[] = [
      {
        rank: 1,
        name: 'Seeded',
        teamName: 'X',
        teamLogo: '',
        displayValue: '10',
        value: 10,
      },
    ];
    const { result } = renderHook(() => useLeaders('nba', seed));
    expect(result.current.loading).toBe(false);
    expect(result.current.leaders).toEqual(seed);
    expect(result.current.error).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

(You'll need to add `import type { Leader } from '../types';` to `useLeaders.test.ts` if not already present. The `useCompetition.test.ts` test references `useCompetition` and the existing test file already imports the types it needs — verify by reading the file before adding new imports.)

- [ ] **Step 4: Add `getCompetitionView` and `getPipelineLeaders` to `src/data/api.ts`**

Add the imports at the top of `src/data/api.ts` (next to the existing `../adapters` import? `src/data/api.ts` does NOT currently import from `../adapters`. Add these two new imports near the top):

```ts
import { getAdapter } from '../adapters';
import type { CompMatch, StandingsData, TopScorer } from '../adapters/types';
import type { Leader } from '../types';
```

(The adapter `transform` returns `{ matches: CompMatch[]; standings: StandingsData; scorers: TopScorer[] }` — the types are in `src/adapters/types.ts`. Verify by reading the adapter types file before adding imports.)

Then add these two functions at the end of `src/data/api.ts` (after `fetchNewsItems` from Plan 3):

```ts
// Compose serve(scoreboard) + serve(standings) + the sport adapter into one
// ready-to-render CompetitionView. Used by the Astro competition pages to
// seed the island's useCompetition hook. Empty shape on any failure path.
export interface CompetitionView {
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
}

const EMPTY_COMPETITION_VIEW: CompetitionView = {
  matches: [],
  standings: { kind: 'soccer', groups: [] },
  scorers: [],
};

export async function getCompetitionView(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<CompetitionView> {
  try {
    const [sbRes, stRes] = await Promise.all([
      serve(comp, 'scoreboard', env, ctx),
      serve(comp, 'standings', env, ctx),
    ]);
    if (!sbRes.ok || !stRes.ok) return EMPTY_COMPETITION_VIEW;
    const [sbJson, stJson] = await Promise.all([sbRes.json(), stRes.json()]);
    return getAdapter(comp.key).transform(sbJson, stJson);
  } catch {
    return EMPTY_COMPETITION_VIEW;
  }
}

// Compose serveLeaders → Leader[] (the same cachedProducer + assembleLeaders
// pipeline the worker uses, but returning the parsed array directly).
// Used by the Astro scorers page for comps with leadersSource === 'pipeline'
// (NBA, eng.1). Empty array on any failure path.
export async function getPipelineLeaders(
  comp: Competition,
  env: Env,
  ctx: ExecutionContext,
): Promise<Leader[]> {
  try {
    const res = await serveLeaders(comp, env, ctx);
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    return Array.isArray(raw) ? (raw as Leader[]) : [];
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
- Vitest reports `Test Files  40 passed (40)` and `Tests  352 passed (352)` (350 baseline + 2 new). If the count is off, **stop and report** — that's a real finding.

- [ ] **Step 6: Commit (deferred — see Task 2)**

Per project convention, the commit is at the end of Task 2. This step intentionally makes no commit.

---

### Task 2: `CompetitionIsland` + 3 Astro pages + verify

**Files:**
- Create: `src/components/CompetitionIsland.tsx`
- Create: `src/pages/[comp]/index.astro`
- Create: `src/pages/[comp]/scorers.astro`
- Create: `src/pages/[comp]/bracket.astro`

**Interfaces:**
- `CompetitionIsland({ comp, section, initialData, initialPipelineLeaders })`: React island component. Wraps `<FixturesView>`. Calls `useCompetition(comp, initialData)` and `useLeaders(initialData ? comp : null, initialPipelineLeaders)` (the `useLeaders` `comp` arg is null when no pipeline leaders are expected, to skip the fetch). Passes the hook results + a `watchableSlugs` (computed by `useStreams` inside the island) to `FixturesView`. Renders nothing on the server (it's `client:only`). Streams is called inside the island; it does its own polling and returns matches, which the island uses to compute `watchableSlugs` (same logic as `App.tsx`).
- The 3 Astro pages: each validates `Astro.params.comp` against `COMPETITIONS`; on unknown comp returns a 404 response. On a known comp, fetches via the new helpers (or, for the `bracket` page, just renders the island — bracket has no async data fetch at this layer; `BracketView` reads from the static `bracketSeeding.ts`). Each page renders a minimal SSR shell (the `<Layout>` + `<main>`) and mounts `<CompetitionIsland client:only="react" />` with the data.
- The Astro pages use `prerender = false` (the `output: "server"` config from the skeleton plan makes this the default for all `.astro` files).

- [ ] **Step 1: Create `src/components/CompetitionIsland.tsx`**

The island's shape:

```tsx
import { useMemo } from 'react';
import type { Leader } from '../types';
import type { StandingsData } from '../adapters/types';
import type { CompMatch, TopScorer } from '../types';
import { useCompetition } from '../hooks/useCompetition';
import { useLeaders } from '../hooks/useLeaders';
import { useStreams } from '../hooks/useStreams';
import FixturesView from './FixturesView';
import type { Section } from '../utils/router';
import { indexStreams, liveStreamForMatch } from '../utils/streamMatch';

interface CompetitionInitialData {
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
}

// The whole competition view (matches / scorers / bracket) as one client-only
// island. Wired to the SSR-fetched seed data from getCompetitionView +
// getPipelineLeaders, so the island skips its first fetch and starts polling
// right where the server left off. Streams come from useStreams (browser-only
// — ppv.st fingerprint-blocks datacenter IPs, so SSR can't pre-compute
// watchableSlugs; the island computes them after mount).
export default function CompetitionIsland({
  comp,
  section,
  initialData,
  initialPipelineLeaders,
}: {
  comp: string;
  section: Section;
  initialData: CompetitionInitialData;
  initialPipelineLeaders?: Leader[];
}) {
  const { matches, standings, scorers } = useCompetition(comp, initialData);
  const { leaders } = useLeaders(initialPipelineLeaders ? comp : null, initialPipelineLeaders);
  const streams = useStreams();

  // Cross-reference ESPN fixtures with ppv.st streams (same logic as
  // App.tsx). Index once per (matches, streams) change.
  const streamIndex = useMemo(() => indexStreams(streams.matches), [streams.matches]);
  const watchableSlugs = useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const m of matches) {
      if (liveStreamForMatch(m, streamIndex, now)) set.add(m.slug);
    }
    return set;
  }, [matches, streamIndex]);

  return (
    <FixturesView
      section={section}
      matches={matches}
      standings={standings}
      scorers={scorers}
      watchableSlugs={watchableSlugs}
      // FixturesView currently calls useLeaders internally; our pipeline
      // data lives in the hook above. We don't add a new prop to
      // FixturesView in this plan — instead, FixturesView's internal
      // useLeaders call gets `comp: null` (no fetch) when we pass
      // initialPipelineLeaders, because we pre-warm the data here.
      // The simplest way: the `pipeline` hook inside FixturesView
      // receives its own data — but it ALREADY does (it calls useLeaders
      // with the same comp). So we need FixturesView to know the
      // pre-warmed leaders. The minimal change: add a `pipelineLeaders`
      // prop to FixturesView and use it if provided. (See Step 2.)
      pipelineLeaders={leaders}
    />
  );
}
```

(That last long comment is a self-note about the FixturesView change in Step 2; in the final file, replace it with a one-liner like `// Pass pipeline leaders so FixturesView skips its internal useLeaders fetch.`)

- [ ] **Step 2: Add a `pipelineLeaders` prop to `FixturesView` (minimal change)**

Modify `src/components/FixturesView.tsx` to accept an optional `pipelineLeaders?: Leader[]` prop. When provided AND `leadersSource === 'pipeline'`, use it as the source of `leaders` for the `<LeadersView>` instead of the `pipeline.leaders` from the internal `useLeaders` call.

The minimal patch to `FixturesView`:

a) Add `Leader` to the existing `import type` line at the top of `FixturesView.tsx` (currently: `import type { CompMatch, Leader, Stage, TopScorer } from '../types';` — `Leader` is already imported, no change needed).

b) Add the prop to the function signature:
```ts
export default function FixturesView({
  section,
  matches,
  standings,
  scorers,
  watchableSlugs = NO_WATCHABLE,
  pipelineLeaders,
}: {
  section: Section;
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
  watchableSlugs?: ReadonlySet<string>;
  // Optional pre-warmed pipeline leaders (from the SSR pass). When provided
  // and leadersSource === 'pipeline', used in place of useLeaders so the
  // first paint shows the SSR data with no fetch.
  pipelineLeaders?: Leader[];
}) {
```

c) In the body, the internal `useLeaders` call becomes:
```ts
  // Hooks must run unconditionally. When pipelineLeaders is provided, the
  // hook is gated to a no-op (comp: null) so the island doesn't double-fetch.
  const pipeline = useLeaders(pipelineLeaders ? null : leadersSource === 'pipeline' ? comp : null, pipelineLeaders);
```

(And the `<LeadersView leaders={pipeline.leaders} ...>` reference stays — when `pipelineLeaders` is provided, the hook returns those as `pipeline.leaders` via the seed path in Step 1's modified `useLeaders`. So the existing JSX needs no change.)

That is the entire FixturesView change. Three small edits: signature + prop + the `useLeaders` line.

- [ ] **Step 3: Create the 3 Astro pages**

Each page has the same shape: validate comp, fetch data, render Layout + CompetitionIsland. The `bracket` page is the simplest (no pipeline leaders, no initialData fetch — bracket is static).

`src/pages/[comp]/index.astro`:
```astro
---
import Layout from '../../layouts/Layout.astro';
import CompetitionIsland from '../../components/CompetitionIsland';
import { getCompetitionView } from '../../data/api';
import { COMPETITIONS } from '../../competitions';

const { comp } = Astro.params;
if (!comp || !Object.hasOwn(COMPETITIONS, comp)) {
  return new Response('Not found', { status: 404 });
}
const competition = COMPETITIONS[comp]!;
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx as Parameters<typeof getCompetitionView>[2];
const initialData = await getCompetitionView(competition, env, ctx);
---
<Layout title={`StreamCup — ${comp}`}>
  <main>
    <CompetitionIsland
      comp={comp}
      section="matches"
      initialData={initialData}
      client:only="react"
    />
  </main>
</Layout>
```

`src/pages/[comp]/scorers.astro`:
```astro
---
import Layout from '../../layouts/Layout.astro';
import CompetitionIsland from '../../components/CompetitionIsland';
import { getCompetitionView, getPipelineLeaders } from '../../data/api';
import { COMPETITIONS } from '../../competitions';

const { comp } = Astro.params;
if (!comp || !Object.hasOwn(COMPETITIONS, comp)) {
  return new Response('Not found', { status: 404 });
}
const competition = COMPETITIONS[comp]!;
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx as Parameters<typeof getCompetitionView>[2];
const initialData = await getCompetitionView(competition, env, ctx);
const initialPipelineLeaders =
  competition.leadersSource === 'pipeline' ? await getPipelineLeaders(competition, env, ctx) : undefined;
---
<Layout title={`StreamCup — ${comp} — Scorers`}>
  <main>
    <CompetitionIsland
      comp={comp}
      section="scorers"
      initialData={initialData}
      initialPipelineLeaders={initialPipelineLeaders}
      client:only="react"
    />
  </main>
</Layout>
```

`src/pages/[comp]/bracket.astro`:
```astro
---
import Layout from '../../layouts/Layout.astro';
import CompetitionIsland from '../../components/CompetitionIsland';
import { getCompetitionView } from '../../data/api';
import { COMPETITIONS } from '../../competitions';

const { comp } = Astro.params;
if (!comp || !Object.hasOwn(COMPETITIONS, comp)) {
  return new Response('Not found', { status: 404 });
}
const competition = COMPETITIONS[comp]!;
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx as Parameters<typeof getCompetitionView>[2];
const initialData = await getCompetitionView(competition, env, ctx);
---
<Layout title={`StreamCup — ${comp} — Bracket`}>
  <main>
    <CompetitionIsland
      comp={comp}
      section="bracket"
      initialData={initialData}
      client:only="react"
    />
  </main>
</Layout>
```

Notes:
- All three pages use `prerender = false` (the default for `output: "server"`).
- The `ctx` cast `as Parameters<typeof getCompetitionView>[2]` mirrors the Plan 3 fix for the same `ExecutionContext` mismatch (the global augmented `ExecutionContext` requires `exports`, but `Astro.locals.runtime.ctx` from `@astrojs/cloudflare` is the un-augmented one). Same fix as the news peel.
- `competition!` (the non-null assertion) is safe because `Object.hasOwn(COMPETITIONS, comp)` returned true; TypeScript needs the hint to narrow.

- [ ] **Step 4: Verify — build, tests, live smoke**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npm run build
npx vitest run 2>&1 | tail -10
```

Expected:
- Build exit 0. `astro check` 0 errors. `astro build` emits `dist/_worker.js/` + the 3 new page bundles.
- Vitest `Test Files  40 passed (40)` and `Tests  352 passed (352)`.

Live smoke (start dev server, curl 3 competition routes + the SPA fallback + news + /api, kill server):

```bash
npm run dev > /tmp/astro-dev.log 2>&1 &
DEV_PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/ >/dev/null 2>&1 && break
done
echo "--- /fifa.world (status + island placeholder) ---"
curl -s -o /tmp/comp.html -w "%{http_code}\n" "http://localhost:4321/fifa.world"
grep -c "astro-island" /tmp/comp.html
echo "--- /fifa.world/scorers ---"
curl -s -o /tmp/scorers.html -w "%{http_code}\n" "http://localhost:4321/fifa.world/scorers"
grep -c "astro-island" /tmp/scorers.html
echo "--- /fifa.world/bracket ---"
curl -s -o /tmp/bracket.html -w "%{http_code}\n" "http://localhost:4321/fifa.world/bracket"
grep -c "astro-island" /tmp/bracket.html
echo "--- /nba/scorers (pipeline comp) ---"
curl -s -o /tmp/nba-scorers.html -w "%{http_code}\n" "http://localhost:4321/nba/scorers"
grep -c "astro-island" /tmp/nba-scorers.html
echo "--- /unknown.comp (404) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/unknown.comp"
echo "--- /news (Plan 3 routes still work) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/news"
echo "--- /fifa.world/match/<slug> (catch-all SPA still handles non-peeled routes) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world/match/some-slug"
echo "--- /api/fifa.world/scoreboard (worker still works) ---"
curl -s "http://localhost:4321/api/fifa.world/scoreboard" | head -c 80
echo
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected:
- All 3 competition routes (`/fifa.world`, `/fifa.world/scorers`, `/fifa.world/bracket`) return 200 with an `astro-island` placeholder each.
- `/nba/scorers` returns 200 (pipeline comp scorers).
- `/unknown.comp` returns 404 (validation rejects).
- `/news` (from Plan 3) still 200.
- `/fifa.world/match/<slug>` (catch-all SPA, not yet peeled) still 200.
- `/api/fifa.world/scoreboard` returns JSON.

If any check fails, **stop and report** — that's a real finding.

- [ ] **Step 5: Commit**

```bash
cd /Users/youming/GitHub/youming-ai/cup
git add src/hooks/useCompetition.ts src/hooks/useCompetition.test.ts src/hooks/useLeaders.ts src/hooks/useLeaders.test.ts src/data/api.ts src/components/CompetitionIsland.tsx src/components/FixturesView.tsx src/pages/\[comp\]/
git commit -m "feat(comp): peel /:comp routes into Astro SSR with initialData island

The three competition routes (/:comp, /:comp/scorers, /:comp/bracket) are
now real Astro pages. Each fetches via the unified data layer
(getCompetitionView → serve(scoreboard+standings) + sport adapter,
getPipelineLeaders → serveLeaders for pipeline-sourced comps) on the
server, validates the comp key against COMPETITIONS (404 on unknown),
and mounts <CompetitionIsland> as a client:only island. The island
wraps <FixturesView> with the polling hooks (useCompetition, useLeaders)
seeded by the SSR data via initialData, so the first paint is the SSR
data and the island just starts polling from where the server left off.

useCompetition and useLeaders both accept an optional initialData
parameter: when provided and non-empty, the state is seeded and the
initial mount-fetch is skipped. Polling still runs. Same pattern as
useNews from Plan 3. Existing tests continue to pass; two new tests
cover the initialData skip-first-fetch behavior.

FixturesView gets a small addition: an optional pipelineLeaders prop.
When provided and leadersSource === 'pipeline', the view uses it in
place of the internal useLeaders result so the island doesn't double-
fetch. The existing <LeadersView leaders={pipeline.leaders} ... />
reference is unchanged because the modified useLeaders returns the seed
data as pipeline.leaders when provided.

Streams stay browser-side (ppv.st fingerprint-blocks datacenter IPs);
the island's useStreams computes watchableSlugs after mount. The SSR
HTML shows match cards without the watchable indicator; the badge
appears once the island hydrates. Brief flash, acceptable for the
first peel.

The catch-all [...all].astro still resolves every non-competition
route via the SPA. The three new .astro pages take the competition
URLs by Astro's more-specific-wins routing. In-SPA navigate('/<comp>...')
still works through the SPA's useRouter → FixturesView path; the SSR
path is additive for direct visits and refreshes (the SEO case)."
```

---

## Self-Review

**1. Spec coverage (design §4 step 3 "Peel pages into SSR, news first → then competition pages"):**
- Competition pages peeled (`/:comp`, `/:comp/scorers`, `/:comp/bracket`) → Task 2 ✓
- Each renders first paint server-side → Task 1 (data layer helpers) + Task 2 (3 pages) ✓
- Interactive view becomes an island → Task 2 Step 1 (`<CompetitionIsland client:only="react">`) ✓
- Hooks gain `initialData` → Task 1 Step 1 (useCompetition) + Step 2 (useLeaders) + Step 3 (tests) ✓
- Unified data layer shared → Task 1 Step 4 (`getCompetitionView` + `getPipelineLeaders` in `src/data/api.ts`) ✓
- Site runs uninterrupted (catch-all still handles non-competition) → Task 2 Step 4 smoke check ✓

**2. Placeholder scan:** No TBD/TODO. File contents given in full. The known trade-off (SSR HTML has no watchable indicator; brief flash on hydration) is documented in the island's notes and the commit message — not a placeholder, an explicit trade-off.

**3. Type/interface consistency:**
- `useCompetition(comp, initialData?)` and `useLeaders(comp, initialData?)` — `initialData` is optional. Existing SPA callers (`App.tsx`, `FixturesView`) pass just `comp` and keep working. ✓
- `FixturesView` gets one new optional prop `pipelineLeaders?`. The function signature change is additive; existing callers that don't pass it see no behavior change. ✓
- `getCompetitionView` and `getPipelineLeaders` use the same `serve*` functions the worker uses, so the KV cache and in-flight coalescing work identically for SSR and /api. ✓
- The 3 Astro pages all use `Astro.locals.runtime.env` and `Astro.locals.runtime.ctx as Parameters<typeof getCompetitionView>[2]` — typed via `env.d.ts`'s `App.Locals extends Runtime<Env>`, with the same cast pattern the news peel (Plan 3) used. ✓
- `<Layout title="…">` reuses the Plan 3 title prop. ✓

**Note on risk:** This is the SECOND per-page peel and the first one that touches `useCompetition` (the largest composite hook) and `FixturesView` (the most complex view). The known unknowns — (a) the hooks actually skipping the first fetch when seeded, (b) `FixturesView` correctly using the pre-warmed leaders when `pipelineLeaders` is provided, (c) the catch-all still resolving every other route, (d) the data-layer helpers composing `serve*` + adapter correctly — all have explicit verification (Task 1 Step 5, Task 2 Step 4). If anything surfaces a regression, that's a real finding to fix in this plan, not paper over.
