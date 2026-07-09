# Team + Player SSR Peel (Migration Plan 6 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up real Astro SSR pages for the two remaining non-sports-data routes — `/:comp/team/:id` and `/player/:id` — so that after this plan the only routes left in the catch-all SPA are the root, the marquee, and any unpeeled edges. Team/player are the last "per-page peel" before the catch-all can be emptied. Both pages are **pure presentation** components — neither fetches data; all data comes from App's `useCompetition` result — so there are no hook changes, no new data-layer helpers, and no initialData wiring in this plan. Just 2 islands (thin wrappers that set up `onBack`), 2 Astro pages (fetch `getCompetitionView` + do pure-data matching), and minimal SSR HTML.

**Architecture:** Two new Astro pages:
- `src/pages/[comp]/team/[id].astro` — validates `comp` and `id`, fetches `getCompetitionView`, finds the team in groups, renders the team header + stats strip as SSR HTML, and mounts `<TeamPageIsland client:only="react" />` for the interactive match list + scorer list with `onBack`.
- `src/pages/player/[id].astro` — No comp prefix (legacy unprefixed path per the current spec). Uses the default competition (`fifa.world`), fetches `getCompetitionView`, finds the player's scorer entry + goals, renders the player header as SSR HTML, and mounts `<PlayerPageIsland client:only="react" />`.

Both islands are thin wrappers that call `useRouter` to get `comp`, set up `onBack` (navigate to `/:comp` matches), and pass the SSR data through to the existing `TeamPage` or `PlayerPage`.

**Tech Stack:** Astro 5, @astrojs/cloudflare, React 18, TypeScript, Vitest, npm. No new dependencies. No hook changes.

## Global Constraints

- **Catch-all SPA still works for every non-team/non-player route.** The peel must not change `[...all].astro`, `AppIsland.tsx`, or `App.tsx`. Only `/:comp/team/:id` and `/player/:id` leave the SPA.
- **No hook changes.** Both team and player are pure presentation; they don't fetch. No `initialData` is needed because the components receive all data as props from the island (which gets it from the Astro page).
- **No new data-layer helpers.** `getCompetitionView` (added in Plan 4) already returns `{ matches, standings, scorers }` — that's the total data these pages need. The Astro page does the matching (find team, filter matches, find player goals) in the frontmatter; these are pure synchronous computations.
- **`PlayerPage` uses the default competition.** The `/player/:id` URL has no comp prefix (legacy path). Per `parseRoute`, it resolves under `DEFAULT_COMPETITION` (fifa.world). The Astro page does the same. If the player isn't found in the default comp's data, a "not found" state is rendered (same as the SPA).
- **All 353 existing tests stay green. No test changes.** This plan creates files only; it modifies no existing source.
- **Astro build must stay green.**
- **Live smoke must pass** for a known team (e.g. `/fifa.world/team/<id>`) + a known player (e.g. `/player/<id>`) + 404 for unknowns + all previously peeled routes + catch-all SPA + `/api/*`.

## File Structure

- Create: `src/components/TeamPageIsland.tsx` — wraps `<TeamPage>`, sets up `onBack` via `useRouter`
- Create: `src/components/PlayerPageIsland.tsx` — wraps `<PlayerPage>`, sets up `onBack`
- Create: `src/pages/[comp]/team/[id].astro` — SSR page for `/:comp/team/:id`
- Create: `src/pages/player/[id].astro` — SSR page for `/player/:id`
- Keep untouched: every other file, including `TeamPage.tsx`, `PlayerPage.tsx`, all hooks, components, pages, configs, docs.

---

### Task 1: Create the two islands

**Files:**
- Create: `src/components/TeamPageIsland.tsx`
- Create: `src/components/PlayerPageIsland.tsx`

**Interfaces:**
- `TeamPageIsland({ teamId, groups, matches, scorers })`: wraps `<TeamPage>`. Calls `useRouter` to get `comp`, sets up `onBack` via `useCallback(() => navigate(pathFor({ kind: 'section', comp, section: 'matches' }), { replace: true }), [comp])`. Passes all props + `onBack` through to `TeamPage`. Renders nothing on the server (it's `client:only`).
- `PlayerPageIsland({ athleteId, groups, matches, scorers })`: same shape, wraps `<PlayerPage>`.

- [ ] **Step 1: Create `src/components/TeamPageIsland.tsx`**

```tsx
import { useCallback } from 'react';
import type { CompMatch, TopScorer, WCGroup } from '../types';
import { useRouter, navigate, pathFor } from '../utils/router';
import TeamPage from './TeamPage';

// Thin island wrapper. Sets up onBack (navigate to /:comp matches) and
// passes all SSR-fetched data through to the existing TeamPage. The
// island is client:only — none of the React hooks run server-side.
export default function TeamPageIsland({
  teamId,
  groups,
  matches,
  scorers,
}: {
  teamId: string;
  groups: WCGroup[];
  matches: CompMatch[];
  scorers: TopScorer[];
}) {
  const { route } = useRouter();
  const onBack = useCallback(
    () =>
      navigate(pathFor({ kind: 'section', comp: route.comp, section: 'matches' }), {
        replace: true,
      }),
    [route.comp],
  );

  return (
    <TeamPage
      teamId={teamId}
      groups={groups}
      matches={matches}
      scorers={scorers}
      onBack={onBack}
    />
  );
}
```

- [ ] **Step 2: Create `src/components/PlayerPageIsland.tsx`**

```tsx
import { useCallback } from 'react';
import type { CompMatch, TopScorer, WCGroup } from '../types';
import { useRouter, navigate, pathFor } from '../utils/router';
import PlayerPage from './PlayerPage';

// Thin island wrapper. Sets up onBack (navigate to /:comp matches) and
// passes all SSR-fetched data through to the existing PlayerPage. The
// island is client:only — none of the React hooks run server-side.
// The comp comes from useRouter (the URL path for /player/:id has no
// comp prefix; useRouter resolves it from window.location, which falls
// back to the default competition via parseRoute's legacy-path logic).
export default function PlayerPageIsland({
  athleteId,
  groups,
  matches,
  scorers,
}: {
  athleteId: string;
  groups: WCGroup[];
  matches: CompMatch[];
  scorers: TopScorer[];
}) {
  const { route } = useRouter();
  const onBack = useCallback(
    () =>
      navigate(pathFor({ kind: 'section', comp: route.comp, section: 'matches' }), {
        replace: true,
      }),
    [route.comp],
  );

  return (
    <PlayerPage
      athleteId={athleteId}
      groups={groups}
      matches={matches}
      scorers={scorers}
      onBack={onBack}
    />
  );
}
```

- [ ] **Step 3: Verify the two files compile (no commit yet)**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0. (Both islands compile — they import existing components with compatible types.)

---

### Task 2: Create the two Astro pages + verify + commit

**Files:**
- Create: `src/pages/[comp]/team/[id].astro`
- Create: `src/pages/player/[id].astro`

**Interfaces:**
- Team page: validates `comp` and `id`, fetches `getCompetitionView`, finds the team in standings, renders header + stats as SSR HTML, mounts `<TeamPageIsland client:only="react" />`.
- Player page: fetches `getCompetitionView` for the default comp, finds the player in scorers + goals, renders header as SSR HTML, mounts `<PlayerPageIsland client:only="react" />`.

- [ ] **Step 1: Create `src/pages/[comp]/team/[id].astro`**

```astro
---
import Layout from '../../../layouts/Layout.astro';
import TeamPageIsland from '../../../components/TeamPageIsland';
import { getCompetitionView } from '../../../data/api';
import { COMPETITIONS } from '../../../competitions';
import type { WCStanding } from '../../../types';

const { comp, id } = Astro.params;
if (!comp || !Object.hasOwn(COMPETITIONS, comp)) {
  return new Response('Not found', { status: 404 });
}
if (!id) {
  return new Response('Not found', { status: 404 });
}
const competition = COMPETITIONS[comp]!;
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx as Parameters<typeof getCompetitionView>[2];
const view = await getCompetitionView(competition, env, ctx);

// Find the team in the standings groups.
let standing: WCStanding | null = null;
let groupLetter = '';
if (view.standings.kind === 'soccer') {
  const groups = view.standings.groups;
  for (const g of groups) {
    const row = g.standings.find((s) => s.teamId === id);
    if (row) {
      standing = row;
      groupLetter = g.name;
      break;
    }
  }
}
const teamName = standing?.name ?? 'Team not found';
const teamFlag = standing?.flag ?? '';
---

<Layout title={`StreamCup — ${teamName}`}>
  <main class="ds-page">
    <div class="ds-page-inner">

      {standing ? (
        <>
          <!-- Team Header -->
          <div class="flex items-center gap-3">
            {teamFlag ? (
              <img src={teamFlag} alt={teamName} class="w-12 h-8 object-cover rounded-micro" />
            ) : (
              <span class="w-12 h-8 bg-overlay/5 rounded-micro" aria-hidden="true"></span>
            )}
            <div>
              <h1 class="font-display font-bold text-2xl text-chalk tracking-wide">{teamName}</h1>
              {groupLetter && (
                <span class="ds-caption uppercase tracking-[0.18em] text-chalkdim">
                  Group {groupLetter}
                </span>
              )}
            </div>
          </div>

          <!-- Stats strip -->
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-card ds-glass p-card">
            <div class="flex flex-col items-center">
              <span class="ds-caption uppercase tracking-wider text-chalkdim/60">MP</span>
              <span class="font-mono tabular-nums text-base text-chalk">{standing.mp}</span>
            </div>
            <div class="flex flex-col items-center">
              <span class="ds-caption uppercase tracking-wider text-chalkdim/60">W</span>
              <span class="font-mono tabular-nums text-base text-pitch">{standing.w}</span>
            </div>
            <div class="flex flex-col items-center">
              <span class="ds-caption uppercase tracking-wider text-chalkdim/60">D</span>
              <span class="font-mono tabular-nums text-base text-chalk">{standing.d}</span>
            </div>
            <div class="flex flex-col items-center">
              <span class="ds-caption uppercase tracking-wider text-chalkdim/60">L</span>
              <span class="font-mono tabular-nums text-base text-live">{standing.l}</span>
            </div>
            <div class="flex flex-col items-center">
              <span class="ds-caption uppercase tracking-wider text-chalkdim/60">GD</span>
              <span class={`font-mono tabular-nums text-base ${standing.gd > 0 ? 'text-pitch' : standing.gd < 0 ? 'text-live' : 'text-chalk'}`}>
                {standing.gd > 0 ? `+${standing.gd}` : standing.gd}
              </span>
            </div>
          </div>
        </>
      ) : (
        <p class="font-mono text-xs text-chalkdim p-card text-center">Team not found</p>
      )}

      <!-- Island: takes over for matches list, scorers list, back button, form pill -->
      <TeamPageIsland
        teamId={id}
        groups={view.standings.kind === 'soccer' ? view.standings.groups : []}
        matches={view.matches}
        scorers={view.scorers}
        client:only="react"
      />

    </div>
  </main>
</Layout>
```

Notes:
- `TeamPage` expects `groups: WCGroup[]` (the soccer kind only). For basketball, the standings are `conferences`, not `groups`. Pass `[]` for basketball comps — the component handles the empty case gracefully (scoreboard `standing` is null → renders "Team not found" or the island uses the match data directly).
- The `ctx` cast uses `getCompetitionView`'s parameter type (same as Plan 4).
- `prerender = false` (default for `output: "server"`).

- [ ] **Step 2: Create `src/pages/player/[id].astro`**

```astro
---
import Layout from '../../layouts/Layout.astro';
import PlayerPageIsland from '../../components/PlayerPageIsland';
import { getCompetitionView } from '../../data/api';
import { COMPETITIONS, DEFAULT_COMPETITION } from '../../competitions';
import type { CompMatch, ScorerEntry } from '../../types';

const { id } = Astro.params;
if (!id) {
  return new Response('Not found', { status: 404 });
}
// /player/:id is a legacy unprefixed path — always resolve under the default
// competition, matching parseRoute's fallback logic.
const competition = COMPETITIONS[DEFAULT_COMPETITION]!;
const env = Astro.locals.runtime.env;
const ctx = Astro.locals.runtime.ctx as Parameters<typeof getCompetitionView>[2];
const view = await getCompetitionView(competition, env, ctx);

const scorer = view.scorers.find((s) => s.athleteId === id);
const playerName = scorer?.name ?? 'Player not found';
---

<Layout title={`StreamCup — ${playerName}`}>
  <main class="ds-page">
    <div class="ds-page-inner">

      {scorer ? (
        <div>
          <h1 class="font-display font-bold text-3xl text-chalk tracking-wide">
            {scorer.name}
          </h1>
          <div class="flex items-center gap-3 mt-1">
            {scorer.teamName && (
              <span class="font-mono text-[11px] uppercase tracking-[0.18em] text-chalkdim/60">
                {scorer.teamName}
              </span>
            )}
            <span class="font-mono text-[11px] text-chalkdim/60">
              {scorer.goals} goals
            </span>
          </div>
        </div>
      ) : (
        <p class="font-mono text-xs text-chalkdim p-card text-center">Player not found</p>
      )}

      <!-- Island: takes over for goals timeline, team nav link, back button, stats -->
      <PlayerPageIsland
        athleteId={id}
        groups={view.standings.kind === 'soccer' ? view.standings.groups : []}
        matches={view.matches}
        scorers={view.scorers}
        client:only="react"
      />

    </div>
  </main>
</Layout>
```

Notes:
- `PlayerPage` also receives `groups: WCGroup[]` — same defensive `[]` for basketball comps.
- The player name renders as "Player not found" in SSR when `scorer` is null. The island's `PlayerPage` also handles the null case (shows the "Player not found" message + back button).
- `prerender = false` (default).

- [ ] **Step 3: Verify — build, tests, live smoke**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npm run build
npx vitest run 2>&1 | tail -10
```

Expected:
- Build exit 0. `astro check` 0 errors. `astro build` emits the 2 new page bundles.
- Vitest `Test Files  40 passed (40)` and `Tests  353 passed (353)` (no test changes — same count as Plan 5).

Live smoke (start dev server, curl team + player + 404 checks + all previous peeled routes + catch-all SPA + /api):

```bash
npm run dev > /tmp/astro-dev.log 2>&1 &
DEV_PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/ >/dev/null 2>&1 && break; done

echo "--- /fifa.world/team/<real-id> (200 + team header + island) ---"
# Get a real team ID from the standings API
TEAM_ID=$(curl -s "http://localhost:4321/api/fifa.world/standings" | head -c 1000 | grep -oE '"id":"[0-9]+"' | head -1 | sed 's/"id":"//;s/"//')
echo "team id: $TEAM_ID"
if [ -n "$TEAM_ID" ]; then
  curl -s -o /tmp/team.html -w "%{http_code}\n" "http://localhost:4321/fifa.world/team/${TEAM_ID}"
  grep -c "font-display font-bold text-2xl" /tmp/team.html
  grep -c "astro-island" /tmp/team.html
fi

echo "--- /fifa.world/team/nonexistent (not found — still 200 from the page, but empty data) ---"
curl -s -o /tmp/team404.html -w "%{http_code}\n" "http://localhost:4321/fifa.world/team/99999999"
grep "Team not found\|font-mono" /tmp/team404.html | head -2

echo "--- /unknown.comp/team/1 (404 comp) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/unknown/team/1"

echo "--- /player/<real-id> (200 + player header + island) ---"
PLAYER_ID=$(curl -s "http://localhost:4321/api/fifa.world/scoreboard" | head -c 5000 | grep -oE '"athleteId":"[0-9]+"' | head -1 | sed 's/"athleteId":"//;s/"//')
echo "player id: $PLAYER_ID"
if [ -n "$PLAYER_ID" ]; then
  curl -s -o /tmp/player.html -w "%{http_code}\n" "http://localhost:4321/player/${PLAYER_ID}"
  grep -c "font-display font-bold text-3xl" /tmp/player.html
  grep -c "astro-island" /tmp/player.html
fi

echo "--- /player/nonexistent (not found) ---"
curl -s -o /tmp/pl404.html -w "%{http_code}\n" "http://localhost:4321/player/99999999"
grep "Player not found\|font-mono" /tmp/pl404.html | head -2

echo "--- /fifa.world (Plan 4 still works) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world"
echo "--- /fifa.world/match/mexico-vs-south-africa-760415 (Plan 5 still works) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world/match/mexico-vs-south-africa-760415"
echo "--- /news (Plan 3 still works) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/news"
echo "--- /fifa.world/scorers (Plan 4 still works) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world/scorers"
echo "--- /api/fifa.world/scoreboard (worker still works) ---"
curl -s "http://localhost:4321/api/fifa.world/scoreboard" | head -c 80
echo
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected:
- Real team ID returns 200 with at least 1 `font-display font-bold text-2xl` match and at least 1 `astro-island` placeholder.
- Real player ID returns 200 with at least 1 `font-display font-bold text-3xl` match and at least 1 `astro-island` placeholder.
- Nonexistent team/player return 200 (the page validates the comp, not the team/player; the "not found" state is rendered inside), with "Team not found" / "Player not found" text.
- Unknown comp returns 404.
- All previously peeled routes + `/api/*` return 200.

If any check fails, **stop and report**.

- [ ] **Step 4: Commit**

```bash
cd /Users/youming/GitHub/youming-ai/cup
git add src/components/TeamPageIsland.tsx src/components/PlayerPageIsland.tsx src/pages/\[comp\]/team/ src/pages/player/
git commit -m "feat(team-player): peel /:comp/team/:id and /player/:id into Astro SSR

The two remaining non-sports-data routes are now real Astro pages:
- /:comp/team/:id → validates comp, fetches getCompetitionView, finds
  the team by id in the standings groups, renders the team header +
  stats strip as SSR HTML for first paint, and mounts <TeamPageIsland
  client:only=\"react\"> for the interactive match list + scorer list.
- /player/:id → uses the default competition (fifa.world, matching
  parseRoute's legacy-path fallback), fetches getCompetitionView, finds
  the player in the scorers feed, renders the player header as SSR
  HTML, and mounts <PlayerPageIsland client:only=\"react\"> for the
  goals timeline + team nav.

Both TeamPage and PlayerPage are pure presentation — they don't fetch,
so no hook changes or initialData wiring is needed. The two new islands
(TeamPageIsland, PlayerPageIsland) are thin wrappers that set up onBack
via useRouter + pathFor + navigate and pass the SSR-fetched data
through to the existing components.

After this plan, the catch-all [...all].astro only handles routes that
haven't been peeled yet (the root, the marquee scoreboard, any
unprefixed legacy paths that resolve to the default competition's
matches, and browser-only stream routes). The next plan can empty
the catch-all and delete the old SPA entry. No test changes — same
353/353 baseline."
```

---

## Self-Review

**1. Spec coverage (design §4 step 3 "Peel pages → team/player"):**
- Team route (`/:comp/team/:id`) peeled → Task 2 Step 1 ✓
- Player route (`/player/:id`) peeled → Task 2 Step 2 ✓
- Each renders first paint server-side → both pages render header + stats as SSR HTML ✓
- Interactive view becomes an island → Task 1 (2 islands) + Task 2 (mounting as client:only) ✓
- No hook changes needed (both are pure presentation) → by design, no changes ✓
- No new data-layer helpers needed (reuse `getCompetitionView`) → by design ✓
- Site runs uninterrupted → Task 2 Step 3 smoke ✓

**2. Placeholder scan:** No TBD/TODO. File contents given in full. The known trade-offs: (a) Player page uses DEFAULT_COMPETITION always, (b) team page passes `[]` for basketball comps' groups, (c) both pages render "not found" SSR HTML when the entity isn't in the data; the island handles the same case with the full component. All documented.

**3. Type/interface consistency:**
- `TeamPageIsland` receives `groups: WCGroup[]` and passes through to `TeamPage` (which uses `groups` for standings lookup + `matches`/`scorers` for filtering). Same types as `App.tsx`. ✓
- `PlayerPageIsland` receives `groups`, `matches`, `scorers` — same as `App.tsx`. ✓
- No new imports in `TeamPage.tsx` or `PlayerPage.tsx` — they're unchanged. ✓
- The `ctx` cast reuses the Plan 4 pattern. ✓

**Note on risk:** This is the simplest peel plan — no hook changes, no data-layer changes, 4 new files total, all pure presentation. The only real integration risk is the dynamic team/player ID lookup in the smoke test (it fetches from the live API, which can be flaky). If the live API returns empty, the smoke test might not find a real ID; the plan documents this and suggests using the `/api/fifa.world/standings` and `/api/fifa.world/scoreboard` real-time data to extract IDs. If both return empty, skip the dynamic-ID checks and just test the nonexistent-ID + 404-comp paths.
