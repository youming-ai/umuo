# Repository Guidelines

## Project Overview
**umuo** is a lightweight, high-performance sports web application for the English Premier League, NBA, LaLiga, Bundesliga, Serie A, Ligue 1, and UEFA Champions League — providing news hubs, match schedules, standings, leaders, transactions, odds, and match detail views, plus a global aggregated news home. It is an **Astro 7 server-rendered (SSR) app with React islands**, deployed as a **single Cloudflare Worker** (`workerd` runtime) that renders pages and edge-caches upstream ESPN APIs in Cloudflare KV. All data is fetched from ESPN's public APIs.

## Architecture & Data Flow
```mermaid
graph TD
  User([Browser]) -->|Page request| MW[middleware.ts: / home, legacy/removed → 307]
  MW --> Page[Astro SSR page src/pages/**]
  Page -->|initialData via src/data/api.ts composer| Layer[Shared data layer]
  User -->|/api/:comp/:resource| Bridge[api/[...route].ts → worker/index.ts]
  Bridge --> Layer
  Layer -->|KV SWR cache + coalesce + serve-stale| KV[(Cloudflare KV CACHE)]
  Layer -->|on miss/revalidate| ESPN[ESPN site/core APIs]
  Page -->|client:load + initialData| Island[SSR-rendered React island]
  Island -->|AbortController + visibility-gated SWR poll| Bridge
```
- **SSR Pages** (`src/pages/**.astro`): Configured with `output: 'server'` via `@astrojs/cloudflare`. Pages validate path parameters against `COMPETITIONS`, extract Worker bindings (`env` from `cloudflare:workers`, `ctx` from `Astro.locals.cfContext`), invoke `src/data/api.ts` composers (`getCompetitionView`, `getCompNews`, `getMatchSummary`, `getLeaderboards`, `getCompMatchBySlug`, `getTeams`, `getTeamDetail`, `getTransactions`, `getLeagueInjuries`), and render React islands server-side with `client:load` + server-computed `initialData` (so the HTML carries the content; only `Ticker` and `ThemeSwitcher` stay `client:only`). Anything an island renders must therefore be identical on the server and at hydration — times go through `LocalTime` (SSR in UTC, re-formatted after mount), and `useTicker` must not touch its module-level state during SSR (Worker isolates outlive the request).
- **Shared Data Layer** (`src/data/api.ts`): Unified data core (`runCached`) shared across SSR composers and `/api/*` endpoints. Implements KV **Stale-While-Revalidate** (`Entry {body, at}`; fresh window → HIT), module-level **in-flight request coalescing** (`inflight = new Map<string, Promise<CachedResult>>()` collapses duplicate concurrent requests), and **serve-stale-on-outage** (upstream failures serve stored KV stale data as `STALE`, or return 502). Emits `x-cache` response header (`HIT|MISS|REVALIDATED|STALE`). Resource TTLs: scoreboard `{fresh:60, keep:86400}`, standings `{fresh:300}`, summary `{fresh:30}`.
- **Worker Bridge** (`src/pages/api/[...route].ts`): Catch-all Astro API route (`prerender=false`) delegating requests to `worker.fetch(request, env, ctx)` in `worker/index.ts`. Allows Astro SSR and edge API endpoints to execute identical Worker code in dev and prod.
- **SportAdapter System** (`src/adapters/`): `SportAdapter` interface (`transform`, `transformSummary`) implemented by `soccer.ts` and `basketball.ts`, registered per `Sport` in `index.ts`, resolved via `getAdapter(compKey)`. Normalizes raw ESPN JSON into discriminated union domain types (`kind: 'soccer' | 'basketball'`).
- **Client Hooks** (`src/hooks/`): `useCompetition`, `useNews`, and `useLeaders` are thin wrappers over **`usePolledResource`** — the one shared SWR engine (seed from `initialData`, `cacheRef` stale-while-revalidate, key-change reset, `AbortController`, visibility-gated poll). Fix polling/caching behaviour there, not in the wrappers. `useMatchDetail` (no interval — the hero renders the immutable `match` prop, so polling only refreshed the tabs) and `useTicker` (module-level ref-counted poller fanning out over every competition's scoreboard) are intentionally NOT built on it — different lifecycles.
- **SSR Navigation (No Client SPA Router)**: `src/utils/router.ts` builds and parses routes (`parseRoute`/`pathFor`); navigation is plain `<a href={pathFor(...)}>` links that trigger native document loads — every view is an independent SSR document.
- **Layout shell & nav hierarchy**: `src/layouts/Layout.astro` is the one 3-col shell (opt-in `left`/`right` named slots; capped `max-w-6xl`, centered; the sticky Ticker strip is full-bleed, the Header below it stays in the capped column). Two nav levels: the **Header** (`Header.astro`) is the primary sports switcher in an ESPN-style top bar (`Home`, `Football` ▾, `NBA` ▾, `Odds`), where each sport tab is a native `<details>/<summary>` disclosure — click/tap/Enter/Space, no hover-to-open (a `display:none` menu is not hit-testable, so a hover gap can never be crossed). `Football` opens a two-column mega-menu (all soccer leagues × the active league's sections); `NBA` opens its section list. The **left rail** (`LeftNav.astro`) is the per-competition section nav. Both — plus `sitemap.xml.ts` and `router.ts` — derive from **`src/sections.ts`** (`SECTIONS`: the single source for which sections exist, their path suffix, label, and capability gate). The global `Odds` tab links to `DEFAULT_COMPETITION`'s odds page via `pathFor`.

## Key Directories
- `src/pages/` — File-based SSR routes: root index (`/`), `[comp]/` (`index` = news hub, `schedule`, `stats`, `transactions`, `odds`, `match/[slug]`, `team/[id]`, `player/[id]`, `teams`), `api/[...route].ts`, `sitemap.xml.ts`.
- `src/data/api.ts` — KV cache core, ESPN upstream pipelines (`assembleLeaders`), and SSR composition methods.
- `src/adapters/` — ESPN payload normalization (`types.ts`, `soccer.ts`, `basketball.ts`, `index.ts`).
- `src/hooks/` — `usePolledResource` (shared SWR engine) + its wrappers (`useCompetition`, `useNews`, `useLeaders`) and the standalone `useMatchDetail`, `useTicker`.
- `src/components/` — Hydration wrappers (`*Island.tsx`; no provider wrapper — `CompetitionDataIsland` is the shared render-prop island behind `CompetitionIsland`/`OddsIsland`, and `ScoresRailIsland` feeds the competition-hub right rail), presentational views (`HomeView`, `FixturesView`, `StandingsView`, `LeadersView`, `StatsView`, `NewsView`, shared `NewsCard`, `ScoresRail`, `TeamsView`, `TeamPage`, `MovesView`, `MatchCard`, `Ticker`), `.astro` shells (`Header`, `Footer`, `LeftNav`), and `matchdetail/` tabs.
- `src/utils/` — Pure helpers: `router.ts`, `wc.ts` (match status/scores/slug), `marquee.ts`, `calendar.ts`, `helpers.ts` (`slugify`), `coerce.ts` (defensive type coercion).
- `src/competitions.ts`, `src/sections.ts`, `src/leaders.ts`, `src/teams.ts`, `src/teamDetail.ts`, `src/transactions.ts`, `src/newsFeed.ts`, `src/types/index.ts` — Domain registries (competitions + sections), leader aggregators, parsers, and type definitions.
- `worker/` — Cloudflare Worker entry point (`index.ts`) and worker unit tests (`index.test.ts`).
- `docs/` — Developer documentation: `espn-api.md` (upstream catalog & quirks), `news-classification-spec.md`.

## Development Commands
Local toolchain requires **Bun** (`bun.lock`); production executes on Cloudflare **workerd**.
- `bun run dev` — Run Astro dev server (`astro dev`) with local Miniflare KV bindings.
- `bun run build` — Full production build: `astro check && tsc -p tsconfig.worker.json && astro build`.
- `bun run typecheck` — Typecheck app (`astro check`) and edge worker (`tsc -p tsconfig.worker.json`).
- `bun run test` — Run unit tests in watch mode (`vitest`). Single pass for CI: `bunx vitest run`.
- `bun run lint` / `lint:fix` — Lint codebase using Biome (`biome lint .` / `--write`).
- `bun run format` / `format:check` — Format files using Biome (`biome format --write .` / check-only).

Deployment occurs out-of-band via Cloudflare Git integration against `wrangler.jsonc`. `wrangler` is not a direct dependency.

## Code Conventions & Common Patterns
- **Formatting (Biome v2.5.1)**: 2-space indentation, single quotes (`'`), explicit semicolons, trailing commas (`all`), 100 column line width, arrow parens (`always`). Excludes `*.css`, `dist`, `.astro`, and `worker-configuration.d.ts`.
- **Naming Conventions**: PascalCase for React components and `.astro` layouts (`MatchCard.tsx`); island wrappers end in `Island` (`CompetitionIsland.tsx`); camelCase for hooks (`useCompetition.ts`) and pure utility modules (`coerce.ts`). Tests are colocated as `<name>.test.ts(x)`.
- **Single Source of Truth**: Domain registries (`src/competitions.ts`, `src/leaders.ts`) are pure TypeScript modules without DOM or React dependencies. They compile under both app and worker tsconfigs. Centralized domain interfaces reside in `src/types/index.ts`.
- **Defensive ESPN Coercion**: Untyped ESPN JSON payloads must be safely unpacked using `src/utils/coerce.ts` primitives (`obj(v)`, `arr(v)`, `str(v)`, `teamLogo(team)`); numeric scores go through `parseScore(v)` in `src/utils/wc.ts`. Prevents runtime `TypeError` crashes on missing or null fields.
- **Async & Cancellation**: Network calls bind an `AbortController`. `fetchWithRetry` applies `AbortSignal.timeout(10_000)` per attempt. Custom hooks abort pending fetches on unmount or key change, and restrict polling to active browser tabs (`document.visibilityState === 'visible'`).
- **Error Handling**: SSR composers degrade gracefully by returning empty arrays or fallback values on failure (preventing SSR page crashes). Hooks suppress `AbortError` and retain cached SWR state during upstream outages.
- **Design Tokens & Dark Mode**: Semantic color tokens are defined as RGB channels (`--c-*`) in `src/index.css` (`:root` / `[data-theme]`) and mapped in `tailwind.config.js` via `rgb(var(--c-*) / <alpha-value>)` (e.g. `bg-panel/85`). Component design system styles use `.ds-*` classes in `src/index.css`.
- **Language & Comments**: Hardcoded UI copy is in English. Multi-lingual or Chinese comments in code explaining complex logic (season rollovers, leader pipelines, ESPN API quirks) should be retained when editing surrounding code.

## Important Files
- `astro.config.mjs` — Astro SSR configuration, Cloudflare adapter (v14), React integration, and unstorage null driver.
- `wrangler.jsonc` — Worker configuration: entrypoint `@astrojs/cloudflare/entrypoints/server`, static assets directory `./dist`, KV cache binding `CACHE`, and `nodejs_compat` flag.
- `src/middleware.ts` — Middleware handling path normalizations, asset passthrough, and 307 redirects (`/fifa.world/**`, legacy `/scorers`, `/<comp>/news`, `/<comp>/bracket`).
- `src/data/api.ts` — Core data layer: SWR cache (`runCached`), in-flight deduplication, ESPN pipeline aggregators, and SSR composers.
- `src/competitions.ts` — Master registry (`COMPETITIONS`), URL builder (`buildUrl`), capability flags (`scorers`, `transactions`, `odds`), and season math. Adding a **soccer/basketball** league is registry-only (soccer uses the `soccerLeague(slug, label)` helper; both reuse the existing adapter). A **new sport** (NFL/MLB/NHL/F1) also needs a new `SportAdapter` in `src/adapters/`. Registry order is the Header nav order.
- `src/teams.ts` / `src/teamDetail.ts` / `src/transactions.ts` — Pure parsers for team directories, team rosters/schedules/injuries, and league transactions.
- `worker/index.ts` — Production Worker HTTP dispatcher serving `/api/*` and binding static assets.
- `src/pages/api/[...route].ts` — Astro↔Worker in-process dev & SSR bridge.
- `public/sw.js` — Service worker (`umuo-v5`) providing Network-first HTML navigations and Cache-first static asset handling (bypasses `/api/*`).

## Runtime / Tooling Preferences
- **Runtime**: Bun (`bun.lock`) locally; Cloudflare Workers (`workerd` V8 isolates) in production. Code must not rely on Node/Bun native APIs at runtime or assume shared persistent in-memory state across isolates.
- **Package Manager**: Bun (`packageManager: "bun@1.3.14"`). Lockfile is `bun.lock`. Do not generate or commit `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
- **TypeScript Configurations**: Dual config strategy.
  - `tsconfig.json`: DOM-aware, extends `astro/tsconfigs/strict`, covers `src/` and `worker/`. Checked via `astro check`.
  - `tsconfig.worker.json`: Pure Worker environment (`target: ES2023`, `lib: ES2024`, **no DOM lib**). Enforces zero DOM API leakage in `worker/`. Checked via `tsc -p tsconfig.worker.json`.
- **Styling**: Tailwind CSS 3.4 + PostCSS + Autoprefixer using CSS variable color channels.
- **Commit Attribution**: AI commits MUST include the trailer:
```
Co-Authored-By: Claude <noreply@anthropic.com>
```

## Testing & QA
- **Framework**: Vitest 4.1.10 configured in `vitest.config.ts` (`environment: 'jsdom'`, `globals: true`, `fileParallelism: false`). Serial test execution is enforced because tests mutate global fetch and window location. Global teardown in `src/test-setup.ts` resets mocks after each test (`afterEach(() => vi.restoreAllMocks())`).
- **Test Colocation & Environments**: Tests are colocated as `<name>.test.ts(x)`. `worker/index.test.ts` explicitly overrides environment with `// @vitest-environment node` (since workers lack DOM bindings).
- **Execution Commands**:
  - Run full suite: `bunx vitest run`
  - Run specific test file: `bunx vitest run worker/index.test.ts`
  - Run specific test by name: `bunx vitest run -t "returns HIT when stored body is fresh"`
- **Testing Patterns**:
  - React Components: `@testing-library/react` (`render`, `screen`) with `@testing-library/jest-dom` matchers.
  - React Hooks: `renderHook` with mocked `globalThis.fetch = vi.fn()`.
  - Astro SSR & Middleware: Import exported `GET` / `onRequest` handlers directly and invoke with mock context.
  - Edge Worker & KV: Use in-memory Map-backed KV (`mockEnv`), `mockCtx`, and `fetchMock` to test `x-cache` edge semantics.
  - Client Navigation: assert the `<a href>` targets components build via `pathFor` (links do native document loads; there is no client router to spy on).
