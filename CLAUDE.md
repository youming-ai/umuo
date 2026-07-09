# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

StreamCup is an **Astro 5 server-rendered app with React islands** for multiple sports competitions (2026 FIFA World Cup, English Premier League, NBA): schedule/standings/scorers/bracket, ESPN-backed match detail pages, a news feed, and live-stream playback. It deploys as a single Cloudflare Worker (Astro's SSR output) that renders pages and edge-caches the upstream data APIs in KV.

## Commands

```bash
bun run dev          # astro dev (port 4321). platformProxy gives a real local KV, so /api/* and SSR hit the actual cache path
bun run build        # astro check + tsc -p tsconfig.worker.json + astro build → dist/ (assets) + dist/_worker.js/ (SSR worker)
bun run preview      # astro preview against the built output
bun run typecheck    # astro check (app+worker, DOM-strict) then tsc -p tsconfig.worker.json (worker, no-DOM workerd lib)
bun run test         # vitest (watch). `bunx vitest run` for a single CI pass
bun run lint         # biome lint .   (lint:fix to autofix)
bun run format       # biome format --write .   (format:check to verify)

bunx vitest run src/utils/wc.test.ts           # one test file
bunx vitest run -t "renders the match header"   # one test by name
```

Deploys to Cloudflare (config in `wrangler.jsonc`: Worker `main` = `dist/_worker.js/index.js`, static `assets` from `dist/`, `CACHE` KV namespace). There is no `deploy` npm script — `wrangler` isn't a dependency, so deployment runs outside the repo (CI / Cloudflare git integration).

Tests run under jsdom with `globals: true` and **`fileParallelism: false`** (`vitest.config.ts`) — tests run serially; don't assume isolation gives you parallel speedups. Setup is `src/test-setup.ts`. Tests are colocated as `*.test.ts(x)`. Worker tests carry a `// @vitest-environment node` header.

`docs/espn-api.md` documents the upstream ESPN endpoints and their quirks (e.g. standings lives under `/apis/v2/`, not `/apis/site/v2/`) — read it before touching URL building or JSON parsing. `docs/news-classification-spec.md` is the news-feed spec.

## Architecture

### Astro SSR shell + React islands — two-stage render
Pages are Astro files under `src/pages/` with `output: "server"` on the `@astrojs/cloudflare` adapter. Each page **fetches its initial data server-side** through the shared data layer (`src/data/api.ts`) using `Astro.locals.runtime.env.CACHE` + `ctx`, renders the first paint, and passes that payload as `initialData` to a React island mounted `client:only="react"` (`@astrojs/react`). The island hydrates, seeds its hook from `initialData`, and takes over interactivity + polling. `AppProviders.tsx` wraps every island with the i18n + theme context. `platformProxy` (dev) hands the same real KV binding to `astro dev`, so local dev exercises the production cache path — there is **no** separate vite dev proxy anymore.

### Routing is split: Astro owns the entry, a custom router owns in-app nav
- **`src/middleware.ts`** (Astro middleware, every request) redirects `/` and legacy unprefixed paths to `/<DEFAULT_COMPETITION>` (`fifa.world`, 307); comp-prefixed routes, `/api`, `/news`, `/player`, and asset paths pass through.
- **File-based routes**: `[comp]/{index,scorers,bracket}`, `[comp]/match/[slug]`, `[comp]/team/[id]`, `player/[id]`, `news/{index,[sport]}`, `news/team/[abbrev]`, `news/league/[slug]`, `api/[...route]`.
- **`src/utils/router.ts`** (the ~150-line History API module — `Route` union, `parseRoute`/`pathFor`/`navigate`/`useRouter`) still runs **inside hydrated islands** for client-side navigation (clicking a match, switching sections/tabs). **Every route carries its competition** as the first URL segment. `pushState` doesn't emit `popstate`, so `navigate()` dispatches a custom `app:routechange` event that `useRouter` listens for. Path segments are untrusted — decode defensively.

### Multi-competition, multi-sport — driven by one registry
`src/competitions.ts` is the **single source of truth** for which competitions the app serves (`fifa.world`, `eng.1`, `nba`) and their `sport`, ESPN `league` slug, `capabilities` (bracket/scorers/lineups/boxscore), `shape` (`tournament` vs `season`), and `leadersSource`. It's pure data + a pure `buildUrl()` — no DOM/React — so it compiles under **both** tsconfigs (app + worker) and every consumer (Astro pages, the worker wrapper, the switcher) builds ESPN URLs from it, so they never drift. `seasonForDate()` handles cross-year season rollover per sport (soccer keys by starting year, rolling in August; NBA keys by ending year, rolling in October). When adding a competition, edit this file.

### The shared data layer is the edge cache — used by SSR and the worker alike
`src/data/api.ts` holds the KV cache/coalesce/serve-stale core **and** the SSR composition helpers, so there is exactly one cache path:
- Low-level: `serve` (scoreboard/standings), `serveSummary`, `serveLeaders`, `serveNews`, and `json`. Per-resource `fresh`/`keep` TTLs; `runCached` is the shared core — `cached` produces from a URL fetch, `cachedProducer` from `JSON.stringify(assembleLeaders(...))`. **Request coalescing** via a module-level in-flight `Map` (concurrent callers share one upstream fetch + one JSON-safe payload, each building its own `Response`). **Serve-stale-on-outage**: return the last good KV copy if upstream fails, error only if nothing cached.
- SSR helpers: `getCompetitionView` (scoreboard + standings + adapter → ready-to-render view), `getPipelineLeaders`, `getCompMatchBySlug`, `getMatchSummary`, `fetchNewsItems`. Astro pages call these directly; islands call same-origin `/api/*`.
- **Coalescing caveat**: `workerd` runs many isolates with no shared memory, so the in-flight `Map` only dedupes within one isolate. What actually protects ESPN is the KV `fresh` window; coalescing is a boundary optimization.

`worker/index.ts` is a **thin HTTP wrapper** over this layer — URL parse → `serve*` dispatch (`/api/<comp>/(scoreboard|standings|summary|leaders)`, `/api/news`; 404 on unknown comp), plus a legacy `ASSETS` fallback for standalone-worker use. In this Astro deployment it's mounted at `/api/*` by the catch-all `src/pages/api/[...route].ts` (`worker.fetch(request, env, ctx)`); Astro serves everything else (SSR pages + static assets from `dist/`).

### Two data backends, fetched two different ways
- **ESPN** (public site/core API, no key, CORS-open) provides all sports + news data, cached in KV by the shared layer.
- **ppv.st** (and other aggregator hosts) provide live streams and are fetched **directly from the browser** (`useStreams.ts`), bypassing the worker, because these hosts fingerprint-block datacenter IPs. Stream iframe URLs are gated through an allowlist in `src/utils/streamSources.ts` (`isTrustedStreamUrl` — HTTPS only, hosts `embedindia.st`/`ppv.st`/`vileembeds.pages.dev`). The earlier `ppv.to` host was seized by law enforcement in July 2026 — do not re-add it.

### Per-sport adapters normalize untyped ESPN JSON
ESPN JSON is untyped and inconsistent per sport, so parsing uses defensive `obj()/arr()/str()` coercion. `src/adapters/` holds one `SportAdapter` per sport (`soccer.ts`, `basketball.ts`), registered by `Sport` in `adapters/index.ts` (`getAdapter(comp)`). `transform(scoreboard, standings)` folds ESPN JSON into `CompMatch[]` + `StandingsData` + `TopScorer[]`; `transformSummary()` produces a `MatchDetail`. `StandingsData` and `MatchDetail` are **discriminated unions on `kind`** (soccer groups vs basketball conferences/boxscore) — views branch on the discriminant. Pure status/score/slug/stage helpers live in `src/utils/wc.ts`; soccer match-detail transforms in `src/utils/espn.ts`.

### Season leaders are a server-side pipeline
`src/leaders.ts` (`assembleLeaders`) is a **pure** aggregator (fetch injected for testing) shared by the worker wrapper, `useLeaders.ts`, and the SSR `getPipelineLeaders`. ESPN's season leaders live on core.api as refs (`$ref`) with no inline names, so it fans out to resolve athlete/team. Competitions declare `leadersSource: 'pipeline'` (eng.1 goals / nba points) or `'scoreboard'` (World Cup aggregates from the scoreboard's per-team leaders, no pipeline). `assembleLeaders` throws on a primary-doc failure so serve-stale can cover an outage instead of overwriting a valid leaderboard with an empty one.

### News feed
ESPN's "now" core API, scoped global / sport / league / team. `src/news.ts` (`NewsParams`, `newsFresh()` — filtered feeds get a longer fresh window than the global firehose), `src/newsFeed.ts` (`parseNewsFeed` → `NewsItem[]`). Server side: `serveNews` (raw KV proxy) + `fetchNewsItems` (compose + parse, empty array on any failure) seed the `news/*` pages; `NewsPageShell.astro` renders SSR, `NewsIsland` + `NewsView` + `useNews.ts` take over client-side. The `Ticker` island (fed by `useStreams`, displays live/upcoming matches in a horizontal strip above the header) is independent of the news feed.

### Data hooks share a pattern
`useCompetition.ts`, `useLeaders.ts`, `useMatchDetail.ts`, `useBracket.ts`, `useStreams.ts`, `useNews.ts` all follow: **stale-while-revalidate** (seeded from SSR `initialData`, refetch in background), `AbortController` per fetch, and **visibility-gated polling** (paused when tab hidden). Hooks keyed by `comp` (or `eventId`) reset cache + displayed state when the key changes, so one competition's data never flashes on another's tab.

### i18n and theme are both custom
- `src/i18n/` — `messages.ts` is a flat `key → string` map per language (`en`, `zh`, `ja`, `ko`; en is the fallback), `index.tsx` provides `LanguageProvider`/`useT`/`translate` with `{var}` interpolation. `messages.test.ts` enforces key parity across languages — add a key to every language.
- `src/theme/` — `ThemeProvider`/`useTheme` toggles `dark`/`light`, persisted to localStorage (defaults to dark). An inline `<script>` in `Layout.astro` sets `data-theme` before hydration to avoid a flash; the CSS tokens key off it.

## Conventions

- **Colors only through tokens.** Palette is CSS variables in `src/index.css` `:root` as `--c-*` channel values (`"R G B"`), mapped to Tailwind colors in `tailwind.config.js` (`night`/`panel`/`panel2`/`line`/`chalk`/`chalkdim`/`pitch`/`live`/`amber`) via `rgb(var(--c-x) / <alpha-value>)` so alpha modifiers (`bg-pitch/40`) work. Light/dark are the same tokens with different channel values. Don't hardcode hex/`rgba()` or use Tailwind's named palette for recurring semantic colors — add a token. Exception: `bg-white/5`-style translucent overlays are the accepted elevation idiom.
- **Visual style** is a rounded "Apple Sports" look (glassmorphism cards `.ds-glass`/`.ds-glass-hero`, soft shadows, overlays). An earlier square/zero-radius aesthetic was removed — don't reintroduce the `borderRadius: 0` Tailwind override.
- **Layout shell**: `Layout.astro` owns the sticky Ticker + Header and opt-in left/right rail slots (3-col grid only when rails are present, so rail-less pages never double-pad).
- **Formatting/lint**: Biome (config `biome.json`), 2-space indent, single quotes, semicolons, trailing commas, line width 100. The `style` rule group is **off**; `*.css` and `worker-configuration.d.ts` are excluded. Run `bun run typecheck` to validate the worker too — `astro check` covers app+worker under DOM-strict, then `tsc -p tsconfig.worker.json` re-checks `worker/**` under the no-DOM workerd `lib` to catch DOM leakage.
- Some inline comments are in Chinese (mostly around season/date logic and the leaders pipeline) — they explain ESPN quirks; preserve them when editing nearby code.

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: Claude <noreply@anthropic.com>
```
