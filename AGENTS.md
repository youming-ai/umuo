# Repository Guidelines

## Project Overview
StreamCup is a high-performance, lightweight web app for tracking sports schedules, standings, scorers, brackets, match detail, news, and live streams (FIFA World Cup, Premier League, NBA). It is an **Astro 5 server-rendered (SSR) app with React islands**, deployed as a single Cloudflare Worker that both renders pages and edge-caches the upstream ESPN APIs in KV.

## Architecture & Data Flow
```mermaid
graph TD
  User([User Browser]) -->|Page request| Astro[Astro SSR page]
  Astro -->|SSR seed via src/data/api.ts| Layer[Shared data layer]
  User -->|/api/:comp/:resource| Route[api/[...route].ts → worker/index.ts]
  Route --> Layer
  Layer -->|KV SWR cache + coalesce| KV[(Cloudflare KV CACHE)]
  Layer -->|serve-stale on outage| ESPN[ESPN site/core API]
  Astro -->|initialData| Island[React island client:only]
  Island -->|visibility-gated SWR polling| Route
  User -->|Live streams, browser-side| Stream[ppv.st / embedindia.st / vileembeds]
```
* **Astro SSR shell**: `output: "server"` on `@astrojs/cloudflare` (`platformProxy` gives real KV bindings in dev). File-based routes under `src/pages/` render the first paint server-side by calling the shared data layer with `Astro.locals.runtime.env.CACHE` + `ctx`, then hydrate React islands (`@astrojs/react`, `client:only="react"`) seeded with `initialData`.
* **React islands + client router**: Once hydrated, islands (`CompetitionIsland`, `RightRailIsland`, `MatchDetailIsland`, `TeamPageIsland`, `PlayerPageIsland`, `NewsIsland`, `Ticker`, `ThemeToggle`) own interactivity. Client-side navigation still uses the hand-rolled History API router (`src/utils/router.ts`: `navigate`/`useRouter`/`pathFor`, `app:routechange` event) — Astro owns the initial route, the router owns in-app navigation.
* **Astro middleware** (`src/middleware.ts`): redirects `/` and legacy unprefixed paths to `/<DEFAULT_COMPETITION>` (`fifa.world`, 307); passes through comp-prefixed routes, `/api`, `/news`, `/player`, and asset paths.
* **Shared data layer** (`src/data/api.ts`): the KV TTL/SWR cache core + in-memory request coalescing + serve-stale-on-outage, PLUS SSR composition helpers (`getCompetitionView`, `getPipelineLeaders`, `getCompMatchBySlug`, `getMatchSummary`, `fetchNewsItems`) and the low-level `serve`/`serveSummary`/`serveLeaders`/`serveNews`/`json`. Both the SSR pages and `worker/index.ts` call these — one cache, one code path.
* **Worker wrapper** (`worker/index.ts`): a thin HTTP layer — URL parse → `serve*` dispatch. Mounted at `/api/*` by the Astro catch-all `src/pages/api/[...route].ts`, which forwards `worker.fetch(request, env, ctx)`. The browser's same-origin `/api/:comp/{scoreboard,standings,summary,leaders}` and `/api/news` go through it.
* **SportAdapter system** (`src/adapters/`): abstract `SportAdapter` (`types.ts`) implemented by `soccer.ts` and `basketball.ts`, registered via `getAdapter(comp)` (`index.ts`). Defensive `obj()/arr()/str()` coercion normalizes untyped ESPN JSON into `CompMatch[]`, `StandingsData`, `MatchDetail` (discriminated unions on `kind`).
* **Stream coupling**: live streams are fetched **browser-side** (`useStreams.ts`), bypassing the worker (aggregator hosts fingerprint-block datacenter IPs). Fixtures cross-reference streams via slugified team names (`src/utils/streamMatch.ts`); iframe URLs pass an HTTPS host allowlist (`isTrustedStreamUrl`, `src/utils/streamSources.ts`).

## Key Directories
* `src/pages/`: Astro file-based SSR routes — `[comp]/` (`index`, `scorers`, `bracket`, `match/[slug]`, `team/[id]`), `news/` (`index`, `[sport]`, `team/[abbrev]`, `league/[slug]`), `player/[id]`, `api/[...route]`.
* `src/layouts/Layout.astro`: page shell — inline theme boot script, sticky Ticker + Header, opt-in left/right rail slots, Footer, PWA/OG head.
* `src/components/`: `*.astro` shells (`Header`, `Footer`, `LeftNav`, `NewsPageShell`), React views (`FixturesView`, `StandingsView`, `BracketView`, `LeadersView`, `MatchDetailPage`, `TeamPage`, `PlayerPage`, `RightRail`, `NewsView`, `MatchCard`, `Player`), `*Island.tsx` hydration wrappers, and `AppProviders.tsx` (i18n + theme context for islands). `matchdetail/` holds the tab subviews.
* `src/data/api.ts`: shared KV cache + SSR composition helpers (see above).
* `src/hooks/`: `useCompetition`, `useMatchDetail`, `useStreams`, `useLeaders`, `useBracket`, `useNews` — SWR + `AbortController` + visibility-gated polling.
* `src/adapters/`: `types.ts`, `soccer.ts`, `basketball.ts`, `index.ts`.
* `src/utils/`: `router.ts`, `calendar.ts` (`.ics`/Google Calendar), `streamSources.ts`, `streamMatch.ts`, `espn.ts` (soccer detail transforms), `wc.ts` (status/score/slug/stage helpers), `marquee.ts` (match selection for ticker display), `helpers.ts` (slugify).
* `src/i18n/` & `src/theme/`: custom i18n (`messages.ts`, en/zh/ja/ko) and theme (`data-theme` dark/light) providers.
* `src/competitions.ts`, `src/leaders.ts`, `src/news.ts`, `src/newsFeed.ts`, `src/types/`: registry, leaders pipeline, news params/parser, shared types.
* `worker/`: `index.ts` HTTP wrapper + `index.test.ts`.
* `docs/`: `espn-api.md` (upstream endpoints + quirks — read before touching URL building/parsing), `news-classification-spec.md`, `superpowers/` (specs + plans).

## Development Commands
Local toolchain: **Bun** (lockfile `bun.lock`). Not the production runtime — code runs on Cloudflare `workerd`.
* `bun run dev`: `astro dev` (default port `4321`). `platformProxy` provides a local KV so `/api/*` and SSR exercise the real cache path.
* `bun run build`: `astro check && tsc -p tsconfig.worker.json && astro build` → `dist/` (assets) + `dist/_worker.js/` (SSR worker).
* `bun run preview`: `astro preview` against the built output.
* `bun run typecheck`: `astro check` (app + worker under DOM-strict) then `tsc -p tsconfig.worker.json` (worker under the no-DOM workerd lib, catches DOM leakage).
* `bun run test`: Vitest. `bunx vitest run` for a single CI pass; `bunx vitest run <file>` / `-t "<name>"` to scope.
* `bun run lint` / `bun run format`: Biome (`lint:fix`, `format:check` variants).

There is no `deploy` script and `wrangler` is not a dependency — deployment runs outside the repo (CI / Cloudflare git integration) against `wrangler.jsonc`.

## Conventions
* **Toolchain**: **Biome** (v2.5.1) only — no ESLint/Prettier. 2-space indent, single quotes, semicolons, trailing commas, width 100; `style` rule group off; `*.css` and `worker-configuration.d.ts` excluded. Tailwind classes sorted by Biome.
* **Competition registry is the single source of truth**: `src/competitions.ts` (pure data + `buildUrl()` + `seasonForDate()`, no DOM/React so it compiles under both tsconfigs). Add a competition here; pages, worker routes, and the switcher all read from it.
* **Colors only through tokens**: CSS variables in `src/index.css` `:root` (`--c-*` as `"R G B"`), mapped in `tailwind.config.js` via `rgb(var(--c-x) / <alpha-value>)`. Don't hardcode hex/`rgba()` or Tailwind's named palette for semantic colors.
* **Glassmorphism style** (`.ds-glass`, `.ds-glass-hero`): rounded "Apple Sports" look, proportional radii (`--r-panel` 24px base; `rounded-micro` 3px; `rounded-pill` capsules). Don't reintroduce the removed zero-radius aesthetic.
* **Naming**: PascalCase React components (`MatchCard.tsx`), PascalCase `.astro` files, camelCase hooks/utils/adapters. Tests colocated as `<name>.test.ts(x)`. Slugify via `src/utils/helpers.ts`.
* **Async**: every fetching effect registers an `AbortController`; hooks poll (30s matches/competition, 60s streams/leaders, 120s news) and suspend on `visibilitychange`; reset cache + state when the `comp`/`eventId` key changes.
* **Routing**: keep Astro middleware, file-based routes, and the client router consistent — every route carries its competition as the first URL segment. Wrap decoded path params in `safeDecode`.
* **i18n**: `messages.ts` is a flat `key → string` map per language (en is the fallback); `messages.test.ts` enforces key parity — add a key to every language.
* Some inline comments are in Chinese (season/date logic, leaders pipeline, ESPN quirks) — preserve them when editing nearby code.

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: Claude <noreply@anthropic.com>
```

## Runtime / TypeScript Targets
* **Runtime**: Bun locally; Cloudflare `workerd` (V8 isolate) in prod — no Node/Bun APIs, no persistent shared memory, CPU/subrequest limits.
* **`tsconfig.json`**: extends `astro/tsconfigs/strict`, includes `src` + `worker` (DOM-aware, JSX). Checked by `astro check`.
* **`tsconfig.worker.json`**: `target` ES2023, `lib` ES2024 (**no DOM**), `worker/**` only — the workerd-context check.

## Testing & QA
* **Framework**: **Vitest** (v1.6.1), config `vitest.config.ts` (`jsdom`, `globals: true`, `fileParallelism: false`, setup `src/test-setup.ts`). Tests run **serially** — don't assume parallel isolation.
* Worker tests (`worker/**/*.test.ts`) use a `// @vitest-environment node` header.
* Clean up mocks in `afterEach` via `vi.restoreAllMocks()`. Mock routing with `Object.defineProperty(window, 'location', ...)`.

## Important Files
* `astro.config.mjs`: Astro SSR + Cloudflare adapter + React integration.
* `wrangler.jsonc`: Worker `main` (`dist/_worker.js/index.js`), `ASSETS` (`dist/`), `CACHE` KV.
* `src/middleware.ts`: canonical-path redirects.
* `src/data/api.ts`: shared cache + SSR composition helpers.
* `src/competitions.ts`: competition registry.
* `worker/index.ts`: `/api/*` HTTP wrapper.
* `public/`: PWA manifest, icons, `og.jpg`, and `sw.js` (registered in production in Layout.astro).
