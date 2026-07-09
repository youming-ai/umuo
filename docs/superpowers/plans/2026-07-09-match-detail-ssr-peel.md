# Match Detail SSR Peel (Migration Plan 5 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a real Astro SSR page for `/:comp/match/:slug` — the match detail route. The page validates the comp key and slug against the scoreboard data, fetches the summary detail server-side through the unified data layer, renders the hero scoreboard (team flags, names, scores, kickoff, stage badge) as static SSR HTML for first paint, and mounts `<MatchDetailPage>` as a `client:only` island for interactivity (tabs, retry, programmatic nav). Stream stays browser-side (ppv.st blocks datacenter IPs); the SSR pass emits the scoreboard and the island takes over the player and tabs after mount.

**Architecture:** One new Astro page (`src/pages/[comp]/match/[slug].astro`) takes over the URL from the catch-all SPA. A new `MatchDetailIsland.tsx` wraps `<MatchDetailPage>` with the SSR-seeded data (`match`, `initialDetail`) and sets up the `onBack` callback internally via `useRouter`. Two new helpers in `src/data/api.ts` — `getCompMatchBySlug(comp, slug, env, ctx)` and `getMatchSummary(comp, eventId, env, ctx)` — compose the existing `serve*` primitives + the sport adapter's `transform` / `transformSummary` into ready-to-render payloads. `useMatchDetail` gains an optional `initialData` param to skip its first fetch when seeded.

**Tech Stack:** Astro 5, @astrojs/cloudflare, React 18, TypeScript, Vitest, npm. No new dependencies.

## Global Constraints

- **Catch-all SPA still works for every non-match-detail route.** The peel must not change `[...all].astro`, `AppIsland.tsx`, or `App.tsx`. Only `/:comp/match/:slug` leaves the SPA. In-SPA `navigate('/<comp>/match/<slug>')` (e.g. from `<MatchCard>`'s `onOpen`) still works through the SPA.
- **Stream stays browser-side.** The ppv.st endpoint fingerprint-blocks datacenter requests; the `stream` prop passed to the island is `null`. The island's `MatchDetailPage` renders without the player on the SSR pass; the player appears once the island computes `useStreams()` and the calling code resolves `liveStreamForMatch(...)`. But note: in the current SPA, `App.tsx` passes the resolved stream to `<MatchDetailPage>` — on the SSR page there's no App, so the island must handle streams itself (see `MatchDetailIsland` design in Task 2).
- **No `useRouter` / `useStreams` / `Header` / `Footer` / i18n refactor.** The island is `client:only="react"` so none of those SSR.
- **`useMatchDetail` is minimally modified** to accept an optional `initialData` parameter (same skip-first-fetch pattern as Plan 3 & 4). The existing `useMatchDetail.test.ts` must pass unmodified for non-seeded callers.
- **All 352 existing tests must stay green.** Add at least one new test covering `useMatchDetail(initialData)` skip-first-fetch behavior = 353 total.
- **Astro build must stay green.** The new `.astro` file + `MatchDetailIsland.tsx` compile under `tsconfig.json` and emit.
- **Live smoke must pass** for a known match (e.g. `/fifa.world/match/<existing-slug>`) + 404 for unknown slug + the catch-all SPA + `/api/*` + all previously peeled routes.

## File Structure

- Modify: `src/hooks/useMatchDetail.ts` — add `initialData?: MatchDetail | null`
- Modify: `src/hooks/useMatchDetail.test.ts` — add one test for `initialData`
- Modify: `src/data/api.ts` — add `getCompMatchBySlug(comp, slug, env, ctx)` and `getMatchSummary(comp, eventId, env, ctx)` helpers
- Modify: `src/components/MatchDetailPage.tsx` — add optional `initialDetail?` prop, forward to `useMatchDetail`
- Create: `src/components/MatchDetailIsland.tsx` — wraps `<MatchDetailPage>`, sets up `onBack` + `stream`
- Create: `src/pages/[comp]/match/[slug].astro` — SSR page
- Keep untouched: `src/pages/[...all].astro`, `src/components/AppIsland.tsx`, `src/App.tsx`, the 4 previous peeled pages (news, competition), `src/utils/router.ts`, `src/hooks/useCompetition.ts`, `src/hooks/useLeaders.ts`, `src/hooks/useStreams.ts`, `src/adapters/*`, `src/i18n/*`, `src/theme/*`, all `src/data/*`, `src/components/**` (except the 3 listed above), `worker/index.ts`, all config files.

---

### Task 1: `useMatchDetail` accepts `initialData`; two new data-layer helpers

**Files:**
- Modify: `src/hooks/useMatchDetail.ts`
- Modify: `src/hooks/useMatchDetail.test.ts`
- Modify: `src/data/api.ts`

**Interfaces:**
- `useMatchDetail(eventId, comp, initialData?)`: add optional third param. When `initialData` is non-null, seed `detail` state with it, set `loading=false`, and skip the initial fetch. The effect continues to re-trigger on `attempt`/`eventId`/`comp` changes for reload and nav. Uses a single `initialRef` check inside the `useEffect` — same pattern as the PRE-FIX useMatchDetail (it never had the two-branch effect bug because it has no compRef/cacheRef state machine).
- `getCompMatchBySlug(comp, slug, env, ctx)`: fetches `serve(comp, 'scoreboard')`, passes `{}` as the standings arg (the adapter handles empty standings gracefully — `arr(obj({}).children)` returns `[]`), calls `getAdapter(comp.key).transform(sbJson, {})`, finds the `CompMatch` where `m.slug === slug`, returns it or `null`.
- `getMatchSummary(comp, eventId, env, ctx)`: wraps `serveSummary(comp, eventId, env, ctx)`, reads the body, calls `getAdapter(comp.key).transformSummary(json)`, returns the `MatchDetail` or `null` on any error path.

- [ ] **Step 1: Add `initialData` to `useMatchDetail`**

Replace the function signature:
```ts
export function useMatchDetail(eventId: string | null, comp: string, initialData?: MatchDetail | null) {
```

Modify the `useState`/`useRef` initializers (replace the existing lines):

```ts
  const seeded = !!initialData;
  const [detail, setDetail] = useState<MatchDetail | null>(initialData ?? null);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const skipRef = useRef(seeded);
```

Modify the `useEffect` to gate the first fetch:

```ts
  useEffect(() => {
    if (!eventId) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);

    fetch(`/api/${comp}/summary?event=${eventId}`, { signal: controller.signal })
      // ... rest unchanged
  }, [eventId, attempt, comp]);
```

(Keep the existing `fetch(...)` promise chain, the abort handling in the `.catch`, and the `.finally`. Only the seeded-gate + useRef initializer is new.)

- [ ] **Step 2: Add the new test**

To `src/hooks/useMatchDetail.test.ts`, add (read the file first to check existing imports; add `MatchDetail` if not already imported):

```ts
  it('skips the first fetch when initialData is provided (non-null)', async () => {
    const seed: MatchDetail = {
      kind: 'soccer',
      homeId: '1',
      awayId: '2',
      stats: [],
      allPlays: [],
      keyPlays: [],
      lineups: [],
      venue: '',
      attendance: null,
    };
    const { result } = renderHook(() => useMatchDetail('760420', 'fifa.world', seed));
    expect(result.current.loading).toBe(false);
    expect(result.current.detail).toEqual(seed);
    expect(result.current.error).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Add the two data-layer helpers to `src/data/api.ts`**

Add imports (next to the existing ones):
```ts
import type { MatchDetail } from '../adapters/types';
```
(Note: `CompMatch` and `TopScorer` were already imported from `../types` in Plan 4's correction.)

Then add these two functions at the end of the file:

```ts
// Find a CompMatch by its URL slug, fetching only the scoreboard (not
// standings — the adapter handles empty standings gracefully). Used by
// the Astro match-detail page to validate the URL AND get the match's
// event ID for the summary call. Returns null if the slug isn't found
// or the upstream fails.
export async function getCompMatchBySlug(
  comp: Competition,
  slug: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<CompMatch | null> {
  try {
    const res = await serve(comp, 'scoreboard', env, ctx);
    if (!res.ok) return null;
    const sbJson: unknown = await res.json();
    const view = getAdapter(comp.key).transform(sbJson, {});
    return view.matches.find((m) => m.slug === slug) ?? null;
  } catch {
    return null;
  }
}

// Fetch + transform the ESPN summary into a MatchDetail. Wraps
// serveSummary + the sport adapter's transformSummary. Returns null on
// any failure path (non-ok, json error, adapter error).
export async function getMatchSummary(
  comp: Competition,
  eventId: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<MatchDetail | null> {
  try {
    const res = await serveSummary(comp, eventId, env, ctx);
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return getAdapter(comp.key).transformSummary(json);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Verify**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
npx vitest run 2>&1 | tail -10
```

Expected: both `tsc` exit 0, vitest `Tests  353 passed (353)` (352 baseline + 1 new). If off, **stop and report**.

- [ ] **Step 5: Commit (deferred to Task 2)**

---

### Task 2: `MatchDetailIsland` + `MatchDetailPage` prop + Astro page + verify

**Files:**
- Modify: `src/components/MatchDetailPage.tsx` — add `initialDetail` prop, forward to `useMatchDetail`
- Create: `src/components/MatchDetailIsland.tsx` — wrap `<MatchDetailPage>`, setup `onBack` via `useRouter`
- Create: `src/pages/[comp]/match/[slug].astro`

**Interfaces:**
- `MatchDetailPage`: gets a new optional `initialDetail?: MatchDetail | null` prop. If provided, forwards to `useMatchDetail(eventId, comp, initialDetail)` — the hook skips the first fetch.
- `MatchDetailIsland`: renders `<MatchDetailPage>` with the SSR-seeded data. Renders nothing on the server (client:only). On the client, it computes `stream` by resolving `useStreams` + `liveStreamForMatch`, sets up `onBack` via `useRouter` + `pathFor + navigate`, and passes everything through.

- [ ] **Step 1: Add `initialDetail` prop to `MatchDetailPage`**

Change the TypeScript prop type (add to the existing destructured props object):

```ts
export default function MatchDetailPage({
  match,
  stream,
  onBack,
  initialDetail,
}: {
  match: CompMatch;
  stream?: Match | null;
  onBack: () => void;
  initialDetail?: MatchDetail | null;
}) {
```

Change the `useMatchDetail` call from:
```ts
const { detail, loading, error, reload } = useMatchDetail(match.id, route.comp);
```
to:
```ts
const { detail, loading, error, reload } = useMatchDetail(match.id, route.comp, initialDetail);
```

That's the entire MatchDetailPage change. Do not touch anything else.

- [ ] **Step 2: Create `src/components/MatchDetailIsland.tsx`**

```tsx
import { useMemo } from 'react';
import { useCallback } from 'react';
import type { CompMatch, Match } from '../types';
import type { MatchDetail } from '../adapters/types';
import { useRouter, navigate, pathFor } from '../utils/router';
import { useStreams } from '../hooks/useStreams';
import { indexStreams, liveStreamForMatch } from '../utils/streamMatch';
import MatchDetailPage from './MatchDetailPage';

// The match-detail island. Wraps <MatchDetailPage> with the SSR-seeded data
// and computes the stream / back action on the client (where useRouter +
// useStreams can run). Mounted by [comp]/match/[slug].astro as client:only.
export default function MatchDetailIsland({
  match,
  initialDetail,
}: {
  match: CompMatch;
  initialDetail: MatchDetail | null;
}) {
  const { route } = useRouter();
  const streams = useStreams();

  const backHome = useCallback(
    () =>
      navigate(pathFor({ kind: 'section', comp: route.comp, section: 'matches' }), {
        replace: true,
      }),
    [route.comp],
  );

  // Resolve the stream (browser-only — ppv.st blocks datacenter IPs).
  const streamIndex = useMemo(() => indexStreams(streams.matches), [streams.matches]);
  const stream: Match | null = useMemo(() => {
    const s = liveStreamForMatch(match, streamIndex, Date.now());
    return s ?? null;
  }, [match, streamIndex]);

  return (
    <MatchDetailPage
      match={match}
      stream={stream}
      onBack={backHome}
      initialDetail={initialDetail}
    />
  );
}
```

- [ ] **Step 3: Create `src/pages/[comp]/match/[slug].astro`**

The Astro page:
1. Validates `comp` against `COMPETITIONS` (404 on unknown).
2. Fetches the `CompMatch` by slug (404 if not found).
3. Fetches the summary detail.
4. Renders the hero scoreboard as static SSR HTML (team flags, names, scores, kickoff, stage badge, venue, status badge).
5. Mounts `<MatchDetailIsland client:only="react" />` for interactivity.

```astro
---
import Layout from '../../../layouts/Layout.astro';
import MatchDetailIsland from '../../../components/MatchDetailIsland';
import { getCompMatchBySlug, getMatchSummary } from '../../../data/api';
import { COMPETITIONS } from '../../../competitions';

const { comp, slug } = Astro.params;
if (!comp || !Object.hasOwn(COMPETITIONS, comp)) {
  return new Response('Not found', { status: 404 });
}
const competition = COMPETITIONS[comp]!;
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx as Parameters<typeof getCompMatchBySlug>[2];
const match = await getCompMatchBySlug(competition, slug!, env, ctx);
if (!match) {
  return new Response('Not found', { status: 404 });
}
const initialDetail = await getMatchSummary(competition, match.id, env, ctx);

// small helpers for the SSR scoreboard markup — pure templates, no React
const statusLabel = (): string => {
  if (match.status === 'upcoming') return '';
  if (match.status === 'live') {
    if (match.progress?.status === 'halftime') return 'HT';
    return match.progress?.displayClock || 'LIVE';
  }
  // finished
  if (match.finishType === 'pens') return 'PENS';
  if (match.finishType === 'aet') return 'AET';
  return 'FT';
};
const stageLabel = (): string => {
  if (!match.stage) return '';
  if (match.stage === 'group') return `Group ${match.group ?? ''}`;
  return match.stage.toUpperCase();
};
const kickoffDate = (): string => {
  if (!match.kickoff) return 'TBD';
  return match.kickoff.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const kickoffTime = (): string => {
  if (!match.kickoff) return '';
  return match.kickoff.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
};
---

<Layout title={`StreamCup — ${match.homeName} vs ${match.awayName}`}>
  <main class="ds-page">
    <div class="ds-page-inner">

      <!-- Hero Scoreboard (SSR) -->
      <div class="ds-glass-hero p-card md:p-8 flex flex-col items-center justify-center relative overflow-hidden">
        <div class="absolute top-0 right-0 w-32 h-32 bg-pitch/5 rounded-pill blur-3xl pointer-events-none select-none"></div>
        <div class="absolute bottom-0 left-0 w-32 h-32 bg-live/5 rounded-pill blur-3xl pointer-events-none select-none"></div>

        {match.stage && (
          <div class="text-center mb-4 shrink-0">
            <span class="ds-caption uppercase tracking-[0.2em] text-chalkdim">
              {stageLabel()}
            </span>
          </div>
        )}

        <div class="flex items-center justify-between w-full max-w-2xl gap-card">
          <!-- Home -->
          <div class="flex-1 flex flex-col items-center text-center min-w-0">
            <div class="w-14 h-10 md:w-20 md:h-14 overflow-hidden rounded-card bg-panel2 shadow-hero mb-3 shrink-0">
              {match.homeFlag ? (
                <img src={match.homeFlag} alt={match.homeName} class="w-full h-full object-cover" />
              ) : (
                <div class="w-full h-full bg-panel2"></div>
              )}
            </div>
            <span class="font-display text-base md:text-xl font-bold text-chalk truncate max-w-full">
              {match.homeName}
            </span>
          </div>

          <!-- Score & Status -->
          <div class="flex flex-col items-center justify-center shrink-0 px-2 sm:px-6">
            {match.status === 'upcoming' ? (
              <div class="text-center">
                <span class="font-mono text-xl md:text-3xl font-black tracking-wider text-chalk">
                  {kickoffTime()}
                </span>
                <div class="ds-caption text-chalkdim mt-1.5">{kickoffDate()}</div>
              </div>
            ) : (
              <div class="flex flex-col items-center">
                <div class="flex items-center justify-center gap-card sm:gap-8 font-display text-4xl md:text-6xl font-black text-chalk tabular-nums select-none leading-none">
                  <span>
                    {match.homeScore ?? 0}
                    {match.homeShootoutScore != null && (
                      <sup class="ml-0.5 text-xl md:text-2xl font-bold text-pitch">
                        ({match.homeShootoutScore})
                      </sup>
                    )}
                  </span>
                  <span class="text-chalkdim/30 text-2xl md:text-3xl font-light font-body select-none">:</span>
                  <span>
                    {match.awayShootoutScore != null && (
                      <sup class="mr-0.5 text-xl md:text-2xl font-bold text-pitch">
                        ({match.awayShootoutScore})
                      </sup>
                    )}
                    {match.awayScore ?? 0}
                  </span>
                </div>
                <div class="mt-3">
                  {match.status !== 'upcoming' && (
                    <span class={`inline-flex items-center px-3 py-0.5 rounded-pill ds-caption font-bold tracking-wider uppercase select-none ${
                      match.status === 'live'
                        ? match.progress?.status === 'halftime'
                          ? 'bg-amber/25 text-amber border border-amber/30'
                          : 'bg-live/25 text-live border border-live/30'
                        : 'bg-chalkdim/10 text-chalkdim border border-overlay/10'
                    }`}>
                      {match.status === 'live' && match.progress?.status !== 'halftime' && (
                        <span class="w-1.5 h-1.5 rounded-pill bg-live animate-pulse mr-1.5"></span>
                      )}
                      {statusLabel()}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <!-- Away -->
          <div class="flex-1 flex flex-col items-center text-center min-w-0">
            <div class="w-14 h-10 md:w-20 md:h-14 overflow-hidden rounded-card bg-panel2 shadow-hero mb-3 shrink-0">
              {match.awayFlag ? (
                <img src={match.awayFlag} alt={match.awayName} class="w-full h-full object-cover" />
              ) : (
                <div class="w-full h-full bg-panel2"></div>
              )}
            </div>
            <span class="font-display text-base md:text-xl font-bold text-chalk truncate max-w-full">
              {match.awayName}
            </span>
          </div>
        </div>
      </div>

      <!-- Island: takes over for tabs, stream player, detail panel, back button -->
      <MatchDetailIsland match={match} initialDetail={initialDetail} client:only="react" />

    </div>
  </main>
</Layout>
```

Notes:
- The status badge markup mirrors the React `StatusBadge` component. The pitch-colored live dot + `animate-pulse` are Astro inline styles.
- `client:only` means the island renders nothing on the server. On the client, it replaces the placeholder with the full `<MatchDetailPage>` (which re-renders the same hero scoreboard + tabs + detail panel). Brief flash is acceptable — same trade-off as the competition pages.
- `prerender = false` is the default for `output: "server"`.
- `match.status` is `'upcoming' | 'live' | 'finished'` — the TypeScript `as` casts on `CompMatch` make the union known at compile time; the SSR helpers use the same discriminant.

- [ ] **Step 4: Verify — build, tests, live smoke**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npm run build
npx vitest run 2>&1 | tail -10
```

Expected:
- Build exit 0. `astro check` 0 errors. `astro build` emits the new page bundle.
- Vitest `Test Files  40 passed (40)` and `Tests  353 passed (353)`.

Live smoke (start dev server, curl the match detail route + 404 checks + other peeled routes + /api + SPA fallback):

```bash
npm run dev > /tmp/astro-dev.log 2>&1 &
DEV_PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/ >/dev/null 2>&1 && break
done

echo "--- /fifa.world/match/<real-slug> (200 + hero scoreboard + island) ---"
# Use a slug from the first match in the scoreboard; if dynamic lookup is too
# fragile, use `curl -s "http://localhost:4321/fifa.world" | grep -oE 'match/[a-z0-9-]+' | head -1`
# to fetch one. For now, try a well-known knob — any valid slug works.
SLUG=$(curl -s "http://localhost:4321/api/fifa.world/scoreboard" | head -c 500 | grep -oE '"slug":"[^"]*"' | head -1 | sed 's/"slug":"//;s/"//')
echo "slug: $SLUG"
curl -s -o /tmp/match.html -w "%{http_code}\n" "http://localhost:4321/fifa.world/match/${SLUG}"
grep -c "ds-glass-hero" /tmp/match.html
grep -c "astro-island" /tmp/match.html
echo "--- /fifa.world/match/nonexistent-slug (404) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world/match/nonexistent"
echo "--- /unknown.comp/match/x (404) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/unknown/match/x"
echo "--- /fifa.world (Plan 4 still works) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world"
echo "--- /news (Plan 3 still works) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/news"
echo "--- /fifa.world/team/1 (catch-all SPA handles non-peeled routes) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world/team/1"
echo "--- /api/fifa.world/scoreboard (worker) ---"
curl -s "http://localhost:4321/api/fifa.world/scoreboard" | head -c 80
echo
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected:
- The real match slug returns 200 with at least 1 `ds-glass-hero` match (hero scoreboard SSR) and at least 1 `astro-island` placeholder.
- Nonexistent slug returns 404.
- Unknown comp returns 404.
- All previously peeled routes + catch-all SPA + `/api/*` return 200.

If any check fails, **stop and report**.

- [ ] **Step 5: Commit**

```bash
cd /Users/youming/GitHub/youming-ai/cup
git add src/hooks/useMatchDetail.ts src/hooks/useMatchDetail.test.ts src/data/api.ts src/components/MatchDetailPage.tsx src/components/MatchDetailIsland.tsx src/pages/\[comp\]/match/
git commit -m "feat(match): peel /:comp/match/:slug into Astro SSR with hero scoreboard + island

The match detail route (/:comp/match/:slug) is now a real Astro page.
It validates the comp key and slug against the scoreboard data (404 on
unknown), fetches the ESPN summary via the unified data layer
(getMatchSummary → serveSummary + transformSummary), renders the hero
scoreboard (team flags, names, scores, kickoff, stage badge, status
badge) as static SSR HTML for first paint, and mounts
<MatchDetailIsland client:only=\"react\"> for the tabs, detail panel,
stream player, and back button.

useMatchDetail gains an optional initialData parameter: when provided
and non-null, the state is seeded, loading is false, and the initial
fetch is skipped. The skipRef pattern is a simple gate inside the
existing useEffect — useMatchDetail never had the two-branch effect
bug (it has no compRef/cacheRef state machine), so the fix from Plan 4
is not needed here. Existing tests pass; one new test covers the
initialData skip-first-fetch behavior.

Two new helpers in src/data/api.ts:
- getCompMatchBySlug(comp, slug, env, ctx): fetches serve(scoreboard),
  passes {} as the standings arg (the adapter handles empty standings
  gracefully), runs the sport adapter's transform, and finds the match
  by slug. Returns null on any failure.
- getMatchSummary(comp, eventId, env, ctx): wraps serveSummary +
  transformSummary. Returns null on any failure.

A new MatchDetailIsland wraps <MatchDetailPage> and sets up the onBack
callback (via useRouter + pathFor) and resolves the stream
(browser-only — ppv.st blocks datacenter IPs; useStreams runs on the
client). The island is client:only; the SSR pass just renders the hero
scoreboard.

The catch-all [...all].astro still handles every non-match-detail route.
In-SPA navigate('/<comp>/match/<slug>') (e.g. from MatchCard) still
works through the SPA's App → MatchDetailPage path; the SSR path is
additive for direct visits and refreshes (the SEO/first-paint case)."
```

---

## Self-Review

**1. Spec coverage (design §4 step 3 "Peel pages into SSR → match detail"):**
- Match detail route (`/:comp/match/:slug`) peeled → Task 2 ✓
- First paint server-side (hero scoreboard SSR) → Task 2 Step 3 (70+ lines of Astro markup) ✓
- Interactive view becomes an island → Task 2 Step 2 (`<MatchDetailIsland client:only="react">`) ✓
- Hooks gain `initialData` → Task 1 Step 1 (`useMatchDetail(initialData)`) + Step 2 (test) ✓
- Unified data layer shared → Task 1 Step 3 (`getCompMatchBySlug` + `getMatchSummary` in `src/data/api.ts`) ✓
- Site runs uninterrupted (catch-all still handles non-match-detail) → Task 2 Step 4 smoke ✓

**2. Placeholder scan:** No TBD/TODO. File contents given in full. The known trade-off (stream player absent from SSR, hero scoreboard re-rendered by the island) is documented — same pattern as competition pages.

**3. Type/interface consistency:**
- `useMatchDetail(eventId, comp, initialData?)` — third arg is optional. Existing callers (`MatchDetailPage` with just `match.id, route.comp`) keep working. ✓
- `getCompMatchBySlug` returns `CompMatch | null`. The Astro page checks for null and returns 404. ✓
- `getMatchSummary` returns `MatchDetail | null`. Same null-check pattern. ✓
- The `ctx` cast `as Parameters<typeof getCompMatchBySlug>[2]` mirrors the Plan 3 & 4 fix for the `ExecutionContext` mismatch. ✓
- `MatchDetailPage` gets one new optional prop `initialDetail?`. The SPA's `App.tsx` calls `<MatchDetailPage match stream onBack />` with no `initialDetail` — backward-compatible. ✓

**Note on risk:** This is the FIRST per-page peel that does SSR hero rendering (the Astro page replicates the React `StatusBadge` + the scoreboard layout). The known risks — (a) the adapter's `transform(sbJson, {})` with an empty standings arg working across both sports, (b) the hero scoreboard markup aligning with the React version, (c) the `getCompMatchBySlug` correctly finding a match by slug — all have explicit checks in the smoke test (the slug lookup returns 404 for non-existent, 200 + `ds-glass-hero` for existent). If anything surfaces a regression, that's a real finding to fix in this plan.
