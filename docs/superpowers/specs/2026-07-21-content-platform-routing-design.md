# Content-platform routing pivot + World Cup removal

Date: 2026-07-21

## Goal

Restructure routing toward an ESPN-style content platform: a global news-first
home, per-competition news hubs, scores as supporting data. Simultaneously
retire the finished 2026 World Cup and the bracket feature it alone used.

We surface ESPN headlines + blurb + image and link out to ESPN for full
articles — we do **not** host article bodies. "Content platform" here means the
information architecture, not us authoring content.

## Scope

Two competitions remain: `eng.1` (Premier League, soccer) and `nba`
(basketball). `DEFAULT_COMPETITION` → `eng.1`.

### Route map (after)

| URL | Behaviour |
|-----|-----------|
| `/` | **New** global home — cross-comp scores strip + aggregated top stories + per-comp cards |
| `/<comp>` | **News-first hub** — scores rail + comp news feed + quick links (was: schedule) |
| `/<comp>/schedule` | Schedule/fixtures (moved from `/<comp>`; renders existing `FixturesView`) |
| `/<comp>/stats`, `/teams`, `/transactions`, `/odds` | unchanged |
| `/<comp>/{match,team,player}/…` | unchanged |
| `/<comp>/news` | 307 → `/<comp>` |
| `/<comp>/bracket` | gone |
| `/fifa.world/**` | gone → 307 → `/` |

Standings stays folded into the schedule view (group/conference filter), as
today — **not** a new page. Upgrade path noted with a `ponytail:` comment.

## Work items

### A. World Cup + bracket removal (deletion pass)

Delete (all WC-only):
- `src/pages/[comp]/bracket.astro`
- `src/hooks/useBracket.ts` (+ `.test`)
- `src/data/bracketSeeding.ts` (+ `.test`)
- `src/components/BracketView.tsx` (+ `.test`)

Edit:
- `src/competitions.ts`: remove `fifa.world` entry; `DEFAULT_COMPETITION = 'eng.1'`.
  Now-unused fields (`dates`, `standingsLevel`, `shape:'tournament'`) — prune from
  the interface/`buildUrl` only if trivially safe; otherwise leave one
  `ponytail:` note. Do **not** chase tournament branches through the adapters.
- `src/utils/router.ts`: drop `'bracket'` from `Section` + `SECTION_SUFFIX` +
  `parseView`. Add `'schedule'` section (`/<comp>/schedule`); the hub (`matches`)
  becomes the comp root. Update the header comment (remove the live-stream line).
- `src/components/LeftNav.astro`: drop the bracket nav item; point "Matches"/
  schedule at `/<comp>/schedule`; the comp root is now the hub.
- `src/pages/sitemap.xml.ts`: drop the `capabilities.bracket` branch; emit
  `/<comp>/schedule`.
- Tests referencing `fifa.world` (worker/index.test.ts, middleware.test.ts,
  hooks, components): re-point to `eng.1`/`nba`.
- `src/pages/[comp]/match/[slug].astro`: drop the stale "live stream" comment.

### B. Middleware redirects (`src/middleware.ts`)

- `/` → serve the new home (stop redirecting root).
- `/fifa.world` and `/fifa.world/*` → 307 `/`.
- `/<comp>/bracket` → 307 `/<comp>`.
- `/<comp>/news` → 307 `/<comp>`.
- Legacy `/news`, `/scorers` redirects: keep, re-pointed to `eng.1` where they
  named the default competition.

### C. Comp hub (`/<comp>` = `src/pages/[comp]/index.astro`)

Was the schedule. Becomes news-first:
- scores rail (reuse `Ticker` / the existing scores-rail island, comp-scoped),
- the comp news feed (reuse `NewsIsland`/`NewsView`/`useNews`, SSR-seeded via
  `getCompNews`),
- quick links to schedule / stats / teams / (transactions|odds per capability).

### D. Schedule page (`/<comp>/schedule` = new `src/pages/[comp]/schedule.astro`)

Move the current `index.astro` body here (SSR via `getCompetitionView`,
`FixturesView` island). No behaviour change beyond the URL.

### E. Global home (`/` = new `src/pages/index.astro`)

- **New SSR helper** in `src/data/api.ts`, e.g. `getHomeView(env, ctx)`: fan out
  `getCompNews` + scoreboard across the registry, merge news by `published`
  desc, cap to N. Reuses existing KV cache/coalesce/serve-stale — no new backend,
  no new dependency.
- Home island: cross-comp scores strip (`Ticker` over all comps) + merged top
  stories + per-comp entry cards. Empty/partial-failure states reuse existing
  patterns (empty array on failure, like `getCompNews`).

## Non-goals

- No sport-level URL nesting (`/soccer/eng.1`) — flat comps stay.
- No dedicated `/<comp>/standings` page.
- No self-hosted article bodies.
- No pruning of the soccer-standings discriminated union (EPL still uses it).

## Testing

- Router: `parseRoute`/`pathFor` for `schedule`, no `bracket`, `eng.1` default.
- Middleware: `/` passes through; `/fifa.world/*`, `/<comp>/bracket`,
  `/<comp>/news` redirects.
- `getHomeView`: merges + sorts news across comps; tolerates one comp failing.
- Update all `fifa.world` fixtures to `eng.1`/`nba`.
- `bun run typecheck` + `bunx vitest run` green.
