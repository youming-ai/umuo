# Consolidation pass — de-dup, delete WC residue, centralize sections

Date: 2026-07-22

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
  `stage`/`setStage` state, the stage-chip render block, and the
  `stage === 'group'`-gated standings branch. The component renders fixtures +
  standings unconditionally.
- `src/utils/wc.ts`: remove `SLUG_TO_STAGE`, `STAGE_LABELS`, `stageLabel`,
  `stageFromSlug`. Keep the pure status/score/slug helpers still in use.
- `src/adapters/soccer.ts`: stop assigning `match.stage` (the only consumers
  were the deleted stage filter/chips).
- `src/types/index.ts`: remove the `Stage` type and the `stage?` field on
  `CompMatch` once nothing writes/reads it.
- `src/components/PlayerPage.tsx` + `PlayerPageIsland.tsx`: rename the
  `groups: WCGroup[]` prop and the `WCGroup` type to `Group` (drop WC naming).
- `src/components/RightRail.tsx`: with `leadersSource` always `'pipeline'`,
  `usesPipeline` is always true — remove the dead scoreboard-scorers fallback
  branch so the rail unconditionally uses the leaders pipeline.
- **Keep** the tournament-level top-scorers block in `soccer.ts` — the player
  page still consumes `CompetitionView.scorers` for name/goals lookup. Add a
  one-line comment naming that as its only remaining consumer.

Verification: `grep -rn "stage\|tournament\|standingsLevel\|WCGroup" src`
returns only intentional matches; existing tests + typecheck green.

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
  hook's current **public return shape** so islands don't change.
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
- **Right-rail shell**: extract the shared glass card-stack shell used by
  `RightRail` and `NewsRightRail` into a small presentational component; the
  two islands keep their own hooks/data (merging the islands would violate
  rules-of-hooks since data sources differ). Only the visual shell unifies.

Verification: existing view/island tests pass; `HomeView`/`NewsView` render
the shared card; snapshot or DOM assertion that both right rails use the shared
shell.

## Sequencing & risk

1 → 2 → 3 → 4. WS1 is pure deletion (do first, immediate clarity). WS2 and WS3
are mechanical with new unit tests. WS4 is component extraction. Each ends
green on `bun run typecheck && bunx vitest run`. No behaviour change is the
acceptance bar throughout — if a test needs its *expectations* changed, that's
a signal the refactor altered behaviour and must be reconsidered.
