# Repository Guidelines

## Project Overview
**umuo** (package `streamcup-web`, older docs say StreamCup) is a lightweight, high-performance sports web app for the FIFA World Cup, Premier League, and NBA — per-competition fixtures, standings, scorers, brackets, news, and match detail. It is an **Astro 5 server-rendered (SSR) app with React islands**, deployed as a **single Cloudflare Worker** that both renders pages and edge-caches the upstream ESPN APIs in KV. All data comes from ESPN's unofficial public APIs; live streams come from third-party aggregators fetched browser-side.

## Architecture & Data Flow
```mermaid
graph TD
  User([Browser]) -->|Page request| MW[middleware.ts: / → /fifa.world, legacy → default comp]
  MW --> Page[Astro SSR page src/pages/**]
  Page -->|initialData via src/data/api.ts composer| Layer[Shared data layer]
  User -->|/api/:comp/:resource| Bridge[api/[...route].ts → worker/index.ts]
  Bridge --> Layer
  Layer -->|KV SWR cache + coalesce + serve-stale| KV[(Cloudflare KV CACHE)]
  Layer -->|on miss/revalidate| ESPN[ESPN site/core APIs]
  Page -->|client:only=react + initialData| Island[React island]
  Island -->|AbortController + visibility-gated SWR poll| Bridge
  User -->|browser-direct, bypasses Worker| Streams[ppv.st / embedindia.st / *.pages.dev]
```
- **SSR pages** (`src/pages/**.astro`): `output: 'server'` on `@astrojs/cloudflare`. Each page validates params against `COMPETITIONS`, pulls `env`/`ctx` from `Astro.locals.runtime`, calls a `src/data/api.ts` composer (`getCompetitionView`, `getCompNews`, `getMatchSummary`, `getPipelineLeaders`, `getCompMatchBySlug`, `getTeams`, `getTeamDetail`, `getTransactions`, `getLeagueInjuries`) to compute `initialData` server-side, then renders a React island `client:only="react"` seeded with that data.
- **Shared data layer** (`src/data/api.ts`): ONE cache core (`runCached`) shared by SSR composers AND `/api/*`. Implements KV **stale-while-revalidate** (`Entry {body, at}`; fresh window → HIT), module-level **request coalescing** (`inflight` Map collapses concurrent identical fetches; each caller builds its own `Response` via `json()` since a body is one-shot), and **serve-stale-on-outage** (produce failure → stored stale body as `STALE`, else 502). `cached()` caches a URL fetch; `cachedProducer()` caches an arbitrary producer's JSON (e.g. leaders). `x-cache` header: `HIT|MISS|REVALIDATED|STALE`. Per-resource TTLs: scoreboard `{fresh:60, keep:86400}`, standings `{fresh:300}`, summary `{fresh:30}`.
- **Worker bridge** (`src/pages/api/[...route].ts`): Astro catch-all (`prerender=false`) that delegates to `worker.fetch(request, env, ctx)` from `worker/index.ts` — the SAME Worker code serving `/api/*` in prod runs in-process during SSR. No separate dev proxy.
- **SportAdapter system** (`src/adapters/`): `SportAdapter` interface (`transform`, `transformSummary`) implemented by `soccer.ts` / `basketball.ts`, registered per `Sport` in `index.ts`, resolved by `getAdapter(compKey)`. Normalizes untyped ESPN JSON into `CompMatch[]`, `StandingsData`, `MatchDetail` (discriminated unions on `kind: 'soccer' | 'basketball'`).
- **Client hooks** (`src/hooks/`): one per view, all sharing the idiom — seed from `initialData` (skip first fetch when seeded), `cacheRef` SWR, `abortRef` AbortController, visibility-gated `setInterval` polling. `useTicker` is a module-level ref-counted shared poller so multiple islands share one cross-competition scoreboard loop.
- **Not a SPA**: the client router was removed. `src/utils/router.ts` only builds/reads URLs (`parseRoute`/`pathFor`); `navigate()` does a real `window.location` navigation — every view is its own SSR document.

## Key Directories
- `src/pages/` — file-based SSR routes: `[comp]/` (`index`, `news`, `scorers`, `bracket`, `transactions`, `match/[slug]`, `team/[id]`, `player/[id]`, `teams`), `api/[...route].ts`, `sitemap.xml.ts`. News is per-competition; there is no global `/news`. `transactions` is capability-gated (NBA only; soccer 307-redirects).
- `src/data/api.ts` — KV cache core + SSR composition helpers.
- `src/adapters/` — `types.ts`, `soccer.ts`, `basketball.ts`, `index.ts` (per-sport ESPN normalization).
- `src/hooks/` — `useCompetition`, `useMatchDetail`, `useNews`, `useLeaders`, `useStreams`, `useBracket`, `useTicker`.
- `src/components/` — `*Island.tsx` hydration wrappers (wrap `AppProviders`), presentational views (`FixturesView`, `StandingsView`, `LeadersView`, `StatsView`, `NewsView`, `BracketView`, `TeamsView`, `TeamPage`, `MovesView`, `MatchCard`, `Ticker`, `Player`), `.astro` shells (`Header`, `Footer`, `LeftNav`); `matchdetail/` holds tab panes.
- `src/utils/` — pure helpers: `router.ts`, `wc.ts` (score/slug/status/stage primitives), `marquee.ts`, `calendar.ts`, `helpers.ts` (`slugify`), `streamMatch.ts`, `streamSources.ts`.
- `src/competitions.ts`, `src/leaders.ts`, `src/teams.ts`, `src/teamDetail.ts`, `src/transactions.ts`, `src/newsFeed.ts`, `src/types/index.ts` — registry, leaders pipeline, team parsers, transactions/injuries parsers, news parser, central domain types.
- `worker/` — `index.ts` HTTP wrapper + `index.test.ts`.
- `docs/` — `espn-api.md` (upstream endpoints + quirks; read before touching URL building/parsing), `news-classification-spec.md`, `superpowers/` (historical specs + plans).

## Development Commands
Local toolchain is **Bun** (lockfile `bun.lock`); prod runs on Cloudflare `workerd`.
- `bun run dev` — `astro dev`. `platformProxy` supplies a real local KV so `/api/*` and SSR exercise the true cache path.
- `bun run build` — `astro check && tsc -p tsconfig.worker.json && astro build` → `dist/` assets + `dist/_worker.js/` SSR worker.
- `bun run typecheck` — `astro check` (app, DOM-aware) then `tsc -p tsconfig.worker.json` (worker, no-DOM).
- `bun run test` — `vitest` (watch). CI single pass: `bunx vitest run`.
- `bun run lint` / `lint:fix` — `biome lint .` / `--write`.
- `bun run format` / `format:check` — `biome format --write .` / check-only.

There is **no `deploy` script** and **`wrangler` is not a dependency** — deployment (and `wrangler types` regen of `worker-configuration.d.ts`) happens out-of-band via CI / Cloudflare Git integration against `wrangler.jsonc`.

## Code Conventions & Common Patterns
- **Formatting**: Biome 2.5.1 only (no ESLint/Prettier) — 2-space indent, single quotes, semicolons, trailing commas (all), width 100, arrow parens always. `recommended` rules minus the `style` group. All `*.css` and `worker-configuration.d.ts` are excluded; Tailwind classes are Biome-sorted.
- **Naming**: PascalCase React components & `.astro` files (`MatchCard.tsx`); island wrappers suffixed `Island` (`CompetitionIsland.tsx`) and wrap `AppProviders`→`ThemeProvider`; `useXxx.ts` hooks; lowerCamelCase pure utils. Tests colocated as `<name>.test.ts(x)`. Slugify via `src/utils/helpers.ts`.
- **Single source of truth**: `src/competitions.ts` (registry + `buildUrl()` + `seasonForDate()`) and `src/leaders.ts` are pure (no DOM/React) so they compile under BOTH tsconfigs and never drift between worker and app. Add a competition here; pages, worker routes, and the switcher read from it. Domain types live centralized in `src/types/index.ts`.
- **Defensive ESPN coercion**: ESPN JSON is untyped/unstable. Every adapter plus `newsFeed.ts`/`leaders.ts` guards field access with the same helpers — `isPlainObject`, `obj(v)`, `arr(v)`, `str(v)`, `score(v)` — so a shape change degrades gracefully instead of throwing.
- **Async**: every fetching effect registers an `AbortController`; hooks poll on a visibility-gated `setInterval` (30s scores/competition, 60s streams/leaders, 120s news) and only fetch when `document.visibilityState === 'visible'`; reset cache + state when the `comp`/`eventId`/query key changes. Wrap decoded path params in `safeDecode`.
- **Error handling**: SSR composers swallow failures into empty shapes / `null` (the page never crashes); hooks ignore `AbortError`, keep stale data on failure, and surface an error only when no cached data exists.
- **Colors only through tokens**: CSS variables in `src/index.css` `:root`/`[data-theme]` (`--c-*` as `"R G B"` channels), mapped in `tailwind.config.js` via `rgb(var(--c-x) / <alpha-value>)` (enables `bg-panel/85`). Never hardcode hex/`rgba()` or Tailwind's named palette for semantic colors. Reusable `.ds-*` component classes live in `src/index.css`.
- **Copy / theme**: UI strings are English-hardcoded; theme is dark/light via `data-theme` (`src/theme/`, anti-FOUC inline script in `Layout.astro`). Some inline comments are Chinese (season/date logic, leaders pipeline, ESPN quirks) — preserve them when editing nearby code.

## Important Files
- `astro.config.mjs` — `output: 'server'`, Cloudflare adapter with `platformProxy`, React integration.
- `wrangler.jsonc` — Worker `main` (`dist/_worker.js/index.js`), `ASSETS` (`dist/`), `CACHE` KV binding, `nodejs_compat`.
- `src/middleware.ts` — canonical-path redirects (`/` → `/<default comp>` 307; legacy `/news*` → `/<comp>/news`; query preserved).
- `src/data/api.ts` — shared cache + SSR composition helpers (`getCompetitionView`, `getTeams`, `getTeamDetail`, `getTransactions`, `getLeagueInjuries`, `getPipelineLeaders`, `getCompNews`, `getMatchSummary`).
- `src/competitions.ts` — competition registry, `buildUrl()`, `seasonForDate()`, `DEFAULT_COMPETITION='fifa.world'`. Capabilities (`bracket`, `scorers`, `lineups`, `boxscore`, `transactions?`) gate nav items and routes.
- `src/teams.ts` / `src/teamDetail.ts` / `src/transactions.ts` — pure parsers for team directory, team detail (roster/schedule/injuries), and league transactions/injuries feeds.
- `worker/index.ts` — `/api/*` HTTP wrapper.
- `src/pages/api/[...route].ts` — Astro↔Worker bridge.
- `public/` — PWA manifest, icons, `og.jpg`, and `sw.js` (registered in **production only** via `Layout.astro`; precaches `/<default comp>`, HTML network-first, never caches `/api/*`).
- `docs/espn-api.md` — ESPN endpoint catalog + quirks (e.g. standings uses `/apis/v2/` WITHOUT the `site/` segment; soccer needs explicit `limit=300`; parse defensively).

## Runtime / Tooling Preferences
- **Runtime**: Bun locally; Cloudflare `workerd` (V8 isolate) in prod — no Node/Bun APIs at runtime, no persistent shared memory (so the coalescing `Map` only spans one isolate), CPU/subrequest limits apply.
- **Package manager**: Bun (`bun.lock`). No npm/pnpm/yarn lock present.
- **TypeScript targets**: `tsconfig.json` extends `astro/tsconfigs/strict`, includes `src` + `worker` (DOM-aware, JSX) — checked by `astro check`. `tsconfig.worker.json` is `target` ES2023 / `lib` ES2024 (**no DOM**), `worker/**` only — the workerd-context check that catches DOM leakage. Both must pass in `build`/`typecheck`.
- **Styling**: Tailwind 3.4 via PostCSS + autoprefixer; the design system is entirely CSS-variable-driven (see color-token rule above).
- **Commit attribution**: AI commits MUST include the trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Testing & QA
- **Framework**: Vitest 1.6.1, config `vitest.config.ts` — `jsdom` environment, `globals: true`, `fileParallelism: false` (**tests run serially** because they mutate `globalThis.fetch` / `window.location`), setup `src/test-setup.ts` (`@testing-library/jest-dom` + a global `afterEach(() => vi.restoreAllMocks())`). No coverage config.
- **Layout**: tests colocated as `<name>.test.ts(x)`. The ONLY per-file env override is `worker/index.test.ts`, which starts with `// @vitest-environment node` (Worker has no DOM).
- **Commands**:
  - All (CI): `bunx vitest run`
  - Single file: `bunx vitest run worker/index.test.ts`
  - By name: `bunx vitest run -t "returns HIT when stored body is fresh"`
  - Watch one file: `bunx vitest worker/index.test.ts`
- **Patterns** (deliberately lightweight — no `vi.mock()` hoisting, no fake timers):
  - Pure components: `@testing-library/react` `render`/`screen` + jest-dom matchers (props-in / DOM-out).
  - Hooks: `renderHook`/`waitFor`/`act` with fetch mocked via `globalThis.fetch = vi.fn()` (or `vi.stubGlobal('fetch', …)` + `vi.unstubAllGlobals()`); reset per file with `mockReset()`/`clearAllMocks()`.
  - Astro SSR handlers/middleware: import the exported `GET`/`onRequest` and call it directly with a hand-built context — no server needed.
  - Worker: hand-rolled Map-backed KV (`mockEnv`), fake `ExecutionContext` (`mockCtx`), `fetchMock`; assert edge-cache semantics via the `x-cache` header and prototype-pollution-safe routing.
  - Router/navigation: stub `window.location` via `Object.defineProperty(window, 'location', { value: {…}, writable: true, configurable: true })`; spy `navigate` via module-namespace `vi.spyOn(router, 'navigate')`.
- Every change SHOULD ship a focused behavioral test; run the touched file(s), not just the full suite, while iterating.
