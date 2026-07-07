# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

StreamCup is a single-page React app for multiple sports competitions (2026 FIFA World Cup, English Premier League, NBA): schedule/standings/scorers/bracket, ESPN-backed match detail pages, and live-stream playback. It deploys as a Cloudflare Worker that serves the static SPA and edge-caches the upstream data APIs.

## Commands

```bash
npm run dev          # Vite dev server (proxies /api/<comp>/* straight to ESPN — no Worker locally)
npm run build        # tsc (app) + tsc -p tsconfig.worker.json (worker) + vite build → dist/
npm run typecheck    # type-check BOTH app and worker without building
npm test             # vitest (watch). `npx vitest run` for a single pass (CI mode)
npm run lint         # biome lint .   (lint:fix to autofix)
npm run format       # biome format --write .

npx vitest run src/utils/wc.test.ts          # one test file
npx vitest run -t "renders the match header"  # one test by name
```

Deploys to Cloudflare (config in `wrangler.jsonc`: Worker `main` + static `assets` from `dist/`, plus the `CACHE` KV namespace). There is no `deploy` npm script — `wrangler` isn't a dependency, so deployment runs outside the repo (CI / Cloudflare git integration).

Tests run under jsdom with `globals: true` and **`fileParallelism: false`** (vite.config.ts) — tests run serially; don't assume isolation gives you parallel speedups. Setup is `src/test-setup.ts`. Tests are colocated as `*.test.ts(x)`.

`docs/espn-api.md` documents the upstream ESPN endpoints and their quirks (e.g. standings lives under `/apis/v2/`, not `/apis/site/v2/`) — read it before touching URL building or JSON parsing.

## Architecture

### Multi-competition, multi-sport — driven by one registry
`src/competitions.ts` is the **single source of truth** for which competitions the app serves (`fifa.world`, `eng.1`, `nba`) and their `sport`, ESPN `league` slug, `capabilities` (bracket/scorers/lineups/boxscore), `shape` (`tournament` vs `season`), and `leadersSource`. It's pure data + a pure `buildUrl()` — no DOM/React — so it compiles under **both** tsconfigs (app + worker) and both the Worker and the dev proxy build upstream ESPN URLs from it, so the two never drift. `seasonForDate()` handles cross-year season rollover per sport (soccer keys by starting year, rolling in August; NBA keys by ending year, rolling in October). When adding a competition, edit this file — the router, worker routes, and switcher all read from it.

### Two data backends, fetched two different ways
- **ESPN** (public site/core API, no key, CORS-open) provides all sports data. The browser calls same-origin `/api/<comp>/{scoreboard,standings,summary,leaders}`. In **prod** these hit the Worker (`worker/index.ts`), which fetches ESPN and KV-caches it. In **dev** there is no Worker — `vite.config.ts` rewrites those paths to ESPN via `buildUrl()`, except `/api/<comp>/leaders`, which is aggregated across several core.api requests and so is handled by a dev middleware calling `assembleLeaders` (the same function the Worker uses). Keep worker routes and the dev proxy in sync — both derive from `competitions.ts`.
- **ppv.st** (and other aggregator hosts) provide live streams and are fetched **directly from the browser** (`useStreams.ts`), bypassing the Worker, because these hosts fingerprint-block datacenter IPs. Stream iframe URLs are gated through an allowlist in `src/utils/streamSources.ts` (`isTrustedStreamUrl`) — only HTTPS URLs on trusted hosts are rendered. (Note: the earlier `ppv.to` host was seized by law enforcement in July 2026 — see the comment in `streamSources.ts`; do not re-add it.)

### Per-sport adapters normalize untyped ESPN JSON
ESPN JSON is untyped and inconsistent per sport, so parsing uses defensive `obj()/arr()/str()` coercion helpers rather than trusting shapes. `src/adapters/` holds one `SportAdapter` per sport (`soccer.ts`, `basketball.ts`), registered by `Sport` in `adapters/index.ts` (`getAdapter(comp)`). Each adapter's `transform(scoreboard, standings)` folds ESPN JSON into the app's shared `CompMatch[]` + `StandingsData` + `TopScorer[]`, and `transformSummary()` produces a `MatchDetail`. `StandingsData` and `MatchDetail` are **discriminated unions on `kind`** (`soccer` groups vs `basketball` conferences/boxscore) — views branch on the discriminant. Pure status/score/slug/stage helpers live in `src/utils/wc.ts`; soccer match-detail transforms live in `src/utils/espn.ts`.

### Season leaders are a server-side pipeline
`src/leaders.ts` (`assembleLeaders`) is a **pure** aggregator (fetch injected for testing) shared by the Worker, `useLeaders.ts`, and the vite dev middleware. ESPN's season leaders live on core.api as refs (`$ref`) with no inline names, so it fans out to resolve athlete/team. Competitions declare `leadersSource: 'pipeline'` (eng.1 goals / nba points) or `'scoreboard'` (World Cup aggregates from the scoreboard's per-team leaders, no pipeline). `LEADERS_BY_SPORT` maps each sport to its one leaderboard category.

### Data hooks share a pattern
`useCompetition.ts` (matches + standings + scorers), `useLeaders.ts`, `useMatchDetail.ts`, `useBracket.ts`, `useStreams.ts` all follow: **stale-while-revalidate** (show cached immediately, refetch in background), `AbortController` per fetch, and **visibility-gated polling** (paused when tab hidden). Hooks keyed by `comp` (or `eventId`) hold a `compRef`/`initialRef` and **reset cache + displayed state when the key changes**, so one competition's data never flashes on another's tab and a new-comp fetch error isn't suppressed against a stale cache.

### The Worker is an edge cache, not app logic
`worker/index.ts`: route `/api/<comp>/(scoreboard|standings|summary|leaders)` (404 on unknown comp), per-resource `fresh`/`keep` TTLs, request coalescing via an in-flight map (concurrent callers share one upstream fetch), and serve-stale-on-outage (returns last good KV copy if upstream fails, 502 only if nothing cached). `runCached` is the shared cache/coalesce/serve-stale core: `cached` produces from a URL fetch, `cachedProducer` from `JSON.stringify(assembleLeaders(...))`. It also serves static assets / SPA fallback via the `ASSETS` binding (`not_found_handling: single-page-application` in wrangler.jsonc), which is what makes deep links resolve on refresh.

### Routing is a custom ~150-line History API module — no react-router
`src/utils/router.ts` defines the `Route` union and `parseRoute`/`pathFor`/`navigate`/`useRouter`. **Every route carries its competition** as the URL first segment: `/<comp>`, `/<comp>/scorers`, `/<comp>/bracket`, `/<comp>/match/<slug>`, `/<comp>/team/<id>`, `/<comp>/player/<id>`. Unprefixed legacy paths resolve under `DEFAULT_COMPETITION`. Because `pushState` doesn't emit `popstate`, `navigate()` dispatches a custom `app:routechange` event that `useRouter` listens for — that's how programmatic navigation stays in sync without prop-drilling a setter. `App.tsx` is the switchboard: it reads the route + competition, derives the top-nav highlight from it (no separate "view" state), and renders the matching page. Path segments are untrusted — decode defensively (`safeDecode`) and fall back to home, never throw.

### i18n and theme are both custom
- `src/i18n/` — `messages.ts` is a flat `key → string` map per language (`en`, `zh`, `ja`, `ko`; en is the fallback), `index.tsx` provides `LanguageProvider`/`useT`/`translate` with `{var}` interpolation. Language is detected from localStorage then `navigator.languages`. `messages.test.ts` enforces key parity across languages — add a key to every language.
- `src/theme/` — `ThemeProvider`/`useTheme` toggles `dark`/`light`, persisted to localStorage (defaults to dark). Drives the `data-theme` root attribute the CSS tokens key off.

## Conventions

- **Colors only through tokens.** Palette is CSS variables in `src/index.css` `:root` as `--c-*` channel values (`"R G B"`), mapped to Tailwind colors in `tailwind.config.js` (`night`/`panel`/`panel2`/`line`/`chalk`/`chalkdim`/`pitch`/`live`/`amber`) via `rgb(var(--c-x) / <alpha-value>)` so alpha modifiers (`bg-pitch/40`) work. Light/dark are the same tokens with different channel values. Don't hardcode hex/`rgba()` or use Tailwind's named palette for recurring semantic colors — add a token. Exception: `bg-white/5`-style translucent overlays are the accepted elevation idiom and are intentionally not tokenized.
- **Visual style** is a rounded "Apple Sports" look (rounded corners, soft shadows, overlays). An earlier square/zero-radius aesthetic was removed — don't reintroduce the `borderRadius: 0` Tailwind override.
- **Single scroll container** (`App.tsx` root) so the sticky `Header` shares the same scrollbar gutter as content and they align across platforms (`--sb-w` in index.css is the single source for that width). Don't add nested scroll containers or per-platform padding hacks.
- **Formatting/lint**: Biome (config `biome.json`), 2-space indent, single quotes, semicolons, trailing commas, line width 100. The `style` rule group is **off**; `*.css` and `worker-configuration.d.ts` are excluded from Biome. Run `npm run typecheck` to validate the worker too (it has a separate `tsconfig.worker.json`).
- Some inline comments are in Chinese (mostly around season/date logic and the leaders pipeline) — they explain ESPN quirks; preserve them when editing nearby code.
