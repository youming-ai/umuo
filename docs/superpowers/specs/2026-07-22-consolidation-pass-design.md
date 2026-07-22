# Consolidation pass — de-dup, delete WC residue, centralize sections

Date: 2026-07-22 (revised: fixed the WS1 `stage`/`MatchDetailPage` gap that
made the original unsound; relaxed the "no behaviour change" bar to match
reality; dropped the dead `useCompetition.scorers` output; clarified SECTIONS
ordering + the `'home'`→`'news'` rename ripple; downgraded the WS4 shell
extraction to optional)

## Goal

The routing pivot + World Cup removal left three kinds of debt that make the
codebase feel "越改越乱": duplicated logic, dead one-sided branches, and
config encoded in four places. This pass **consolidates within the existing
architecture** (pages→islands→hooks→data, registry-driven, one cache path) —
it does **not** restructure it. No behaviour change intended; this is a
refactor validated by the existing test suite plus targeted new tests.

Grounded in the architecture map (see conversation 2026-07-22). Four
independent workstreams, each independently shippable and testable.

## Non-goals

- No change to the page/island/hook/data layering or the routing scheme.
- **`getCompetitionView` "god-fetch" split is out** — 7 pages SSR-fetch a full
  scoreboard+standings only to seed the right rail. Real payoff but high risk
  (touches SSR seeding on 7 pages); deferred to its own later PR.
- `useTicker` is **not** folded into the shared hook — it's a module-level
  shared poller with a different lifecycle; forcing it in would break the
  shared-listener behaviour. Leave a `ponytail:` note.
- No new dependencies.

## Workstream 1: Delete World Cup dead code

Both live comps are `shape:'season'`, `leadersSource:'pipeline'`, no `dates`,
no `standingsLevel` — so all tournament/scoreboard alternatives are dead
one-sided branches.

- `src/competitions.ts`: remove the `dates`, `standingsLevel` fields; remove
  `shape` and the `'tournament'` union member (every comp is `'season'`);
  remove the `'scoreboard'` arm of `leadersSource` (keep `'pipeline'` only, or
  drop the field's union to just `'pipeline'`). In `buildUrl`, delete the
  `if (c.dates)` and `if (c.standingsLevel)` branches.
- `src/components/FixturesView.tsx`: remove `KNOWN_STAGES`, the `stages` memo,
  `stage`/`setStage` state, the stage-chip render block, the
  `stage === 'group'`-gated standings branch, **and the local `shape` variable
  plus both its reads** — the `shape !== 'season'` wrapper (~line 162) and the
  `shape === 'season'` ternary (~line 193) that gates the league standings.
  With `shape` gone the component renders fixtures + the soccer-league
  standings unconditionally (still guarded by `standings.kind === 'soccer'`
  and `groups.length > 0`).
- `src/components/MatchDetailPage.tsx`: **delete the stage/group label block in
  the match hero** (`{match.stage && <span>{stageLabel(match.stage, match.group)}</span>}`,
  ~line 162) and drop the now-unused `stageLabel` import. This is the consumer
  the original draft missed. See the behaviour-change note below — for the
  remaining season comps this label was already wrong (`stageFromSlug` falls
  back to `'group'` for any non-tournament season slug, so every EPL match
  currently renders a meaningless "Group" caption); removing it is the cleanup.
- `src/utils/wc.ts`: remove `SLUG_TO_STAGE`, `STAGE_LABELS`, `stageLabel`,
  `stageFromSlug` — **only after** the two call-sites above (FixturesView chips
  + MatchDetailPage hero block) are gone. Keep the pure status/score/slug
  helpers still in use.
- `src/adapters/soccer.ts`: stop assigning `match.stage` (drop the
  `stageFromSlug` call, ~line 212). This is what stops the bogus "Group" label.
- `src/types/index.ts`: remove the `Stage` type and the `stage?` field on
  `CompMatch` once nothing writes/reads it.
- `src/components/PlayerPage.tsx` + `PlayerPageIsland.tsx`: rename the
  `groups: WCGroup[]` prop and the `WCGroup` type to `Group` (drop WC naming).
- `src/components/RightRail.tsx`: with `leadersSource` always `'pipeline'`,
  `usesPipeline` is always true — remove the dead scoreboard-scorers fallback
  branch so the rail unconditionally uses the leaders pipeline.
- `src/hooks/useCompetition.ts`: its `scorers` return value is **dead output** —
  neither `CompetitionIsland` nor `OddsIsland` destructures it (both take only
  `{ matches, standings, loading, error, refetch }`). The sole real consumer of
  `CompetitionView.scorers` is the player page (SSR, via `getCompetitionView`),
  which doesn't go through this hook. Drop `scorers` from the hook's state and
  return shape here. (The WS3 "preserve public return shape" carve-out does
  **not** apply to this field — it's deleted in WS1, not preserved into WS3.)
- **Keep** the tournament-level top-scorers block in `soccer.ts` — the player
  page still consumes `CompetitionView.scorers` for name/goals lookup. Add a
  one-line comment naming the player page as its only remaining consumer, and
  note this is a **separate path** from the leaders pipeline (`useLeaders` /
  `getLeaderboards`) so a future reader doesn't assume the two scorers feeds
  are the same.

**Behaviour-change note (WS1 only):** two user-visible deltas are intended and
unavoidable here, both removals of WC-era residue rather than regressions:
(a) the match-detail hero no longer shows a stage/group label, and (b) the
FixturesView stage chips disappear. Both were no-ops or actively wrong for
season comps. WS1 is the one workstream where "no behaviour change" does not
hold — see the relaxed acceptance bar at the end of this doc.

Tests that need their **expectations** updated (deletions, not logic changes):
`soccer.test.ts` and `useCompetition.test.ts` both assert
`expect(...stage).toBe('group'|'r16')` → become `toBeUndefined()`;
`basketball.test.ts` already asserts `toBeUndefined()` and stays as-is. Add
these to the WS1 checklist explicitly rather than treating them as surprises.

Verification: `grep -rn "stage\|tournament\|standingsLevel\|WCGroup" src`
returns only intentional matches; updated tests + typecheck green.

## Workstream 2: One SECTIONS table

Section identity (which sections exist, their path suffix, nav label, and
capability gate) is currently duplicated across `router.ts`, `LeftNav.astro`,
`sitemap.xml.ts`, and per-page redirects.

- Create `src/sections.ts` (pure data, compiles under both tsconfigs like
  `competitions.ts`):
  ```ts
  export type Section = 'news' | 'schedule' | 'stats' | 'teams' | 'transactions' | 'odds';
  export interface SectionDef {
    section: Section;
    suffix: string;            // '' for the news hub root
    label: string;             // nav label
    capability?: 'scorers' | 'transactions' | 'odds'; // gate; undefined = always on
  }
  export const SECTIONS: SectionDef[];   // ordered as the nav shows them
  ```
  Rename the misleading `'home'` → `'news'` (it renders the per-comp news hub;
  `home` collided with the global `/`).
- **`SECTIONS` array order must match the live nav**: News, Schedule, Teams,
  Stats, Moves, Odds — i.e. **Teams before Stats** (see `LeftNav.astro:12-22`;
  the union-literal order in the snippet above is not significant, the array
  order is). The capability gate for Stats is `scorers` (not a new `stats`
  capability) — matches both `LeftNav.astro` and `sitemap.xml.ts` today.
- **Rename ripple (`'home'` → `'news'`)** touches `router.ts` (the `Section`
  type + the two `parseView` fallbacks) and `router.test.tsx:7,84` (both assert
  `section: 'home'` literally → update to `'news'`). Benign text sync, not a
  behaviour change.
- `src/utils/router.ts`: import `Section` + build `SECTION_SUFFIX` from
  `SECTIONS` (no second copy). `pathFor`/`parseView` unchanged in behaviour;
  root parses to `section:'news'`.
- `src/components/LeftNav.astro`: map over `SECTIONS`, gating on
  `capability ? caps?.[capability] : true`, and build hrefs via `pathFor`
  (not hand-rolled templates). `active` still highlights the current section.
- `src/pages/sitemap.xml.ts`: map over `SECTIONS` with the same gate.
- Pages: keep each `[comp]/<section>.astro` capability redirect, but read the
  gate from `SECTIONS`/capabilities consistently (no behaviour change).

Verification: nav, sitemap, and router all derive from `SECTIONS`; new unit
test asserts `SECTION_SUFFIX` keys === `SECTIONS` sections and that the router
round-trips every section.

## Workstream 3: One polling hook

`useCompetition`, `useNews`, `useLeaders` are the same SWR + `AbortController`
+ visibility-gated poll + comp-reset engine written three times;
`useMatchDetail` is a fourth (no interval) variant.

- Create `src/hooks/usePolledResource.ts`:
  ```ts
  export function usePolledResource<T>(
    opts: {
      url: string | null;          // null = skip (e.g. no comp/event)
      parse: (json: unknown) => T;  // adapter/transform/parseNewsFeed
      key: string;                  // reset cache+state when this changes (comp or comp:event)
      initialData?: T;              // SSR seed
      intervalMs?: number;          // 0/undefined = fetch once, no poll
    },
  ): { data: T | undefined; loading: boolean; error: string | null; refetch: () => void };
  ```
  Implements: seed-from-`initialData`, `cacheRef` SWR, key-change reset,
  skip-first-fetch-when-seeded, abort-per-fetch, error-only-when-no-cache,
  `setInterval` + `visibilitychange` gating + cleanup (only when `intervalMs`).
- Rewrite `useCompetition` (30s), `useNews` (120s), `useLeaders` (60s) as thin
  wrappers: build the URL, pass the parse step, pass the key. Preserve each
  hook's current **public return shape** so islands don't change — **except
  `useCompetition.scorers`**, which WS1 deletes as dead output (no island reads
  it). The rewritten `useCompetition` returns
  `{ matches, standings, loading, error, refetch }`.
- Rewrite `useMatchDetail` over it with `intervalMs: 0` and key
  `` `${comp}:${eventId}` ``, preserving its keep-stale-on-failure return shape.
- Leave `useTicker` as-is; add: `// ponytail: module-level shared poller, not
  folded into usePolledResource — different lifecycle (one loop, many islands).`

Verification: each existing hook test (`useMatchDetail.test.ts`, etc.) passes
unchanged; add a `usePolledResource.test.ts` covering seed, key-reset,
skip-on-null, and no-poll-when-interval-0.

## Workstream 4: De-dup islands, cards, right-rail shell

- **`CompetitionDataIsland`**: extract the shared `useCompetition` +
  loading/error/retry wrapper (currently byte-identical in `CompetitionIsland`
  and `OddsIsland`) into one island taking a render prop / children:
  ```tsx
  <CompetitionDataIsland comp={comp} initialData={initialData}>
    {(view) => <FixturesView …/>}   // or <OddsView …/>
  </CompetitionDataIsland>
  ```
  `CompetitionIsland`/`OddsIsland` become thin call-sites (or the pages call
  `CompetitionDataIsland` directly with the right leaf).
- **Shared `<NewsCard>`**: extract the article-card (image + headline +
  description + internal/external link guard) used by both `HomeView`
  (`HomeNewsCard`) and `NewsView` (`NewsCard`) into one
  `src/components/NewsCard.tsx`; both consume it. Keep each view's own layout
  (lead card, masonry, infinite scroll) — only the card unifies.
- **Right-rail shell (optional / likely skip)**: `RightRail` and
  `NewsRightRail` share only a visual motif (`<div class="flex flex-col gap-4">`
  wrapping repeated `ds-glass p-4` cards); their content is entirely different
  (standings+leaders vs headlines+ticker) and merging the islands would
  violate rules-of-hooks. Extracting the shell yields a near-trivial wrapper and
  adds an indirection layer for little readability gain — **drop this sub-item
  unless, during implementation, the duplication turns out larger than the
  `ds-glass` motif.** Default: leave both rails as-is.

Verification: existing view/island tests pass; `HomeView`/`NewsView` both
render the shared `<NewsCard>`. (The right-rail shell sub-item is optional —
if skipped, there is nothing extra to assert here; if taken, a DOM assertion
that both rails render through the shared shell component.)

## Sequencing & risk

1 → 2 → 3 → 4. WS1 is deletion (do first, immediate clarity). WS2 and WS3 are
mechanical with new unit tests. WS4 is component extraction. Each ends green on
`bun run typecheck && bunx vitest run`.

**Acceptance bar (relaxed from the first draft):** the goal is **no
*user-visible* behaviour change** except the two WC-residue removals explicitly
called out in WS1 (match-detail stage label + FixturesView stage chips). That
distinction matters because several edits are *expected* to require updating
test **expectations** with no underlying logic change:

- WS1: `soccer.test.ts` / `useCompetition.test.ts` `.stage` assertions →
  `toBeUndefined()` (deletion); WS2: `router.test.tsx` `'home'` → `'news'`
  (rename).
- These are mechanical text syncs to tests that encode the old shape/name, not
  signals of a logic regression. A genuine red flag — the kind that should stop
  the refactor — is a test whose *arrange/act* or a non-rename *expect* needs to
  change, or any view/island test whose rendered DOM shifts in a way not
  described by a workstream above.

**WS1 ↔ WS3 interaction:** both touch `useCompetition`. Do WS1's `scorers`
deletion *before* WS3's rewrite so the dead field isn't carried into
`usePolledResource` and re-removed. The 1→3 ordering already guarantees this;
just don't re-add `scorers` to the wrapper during WS3.
