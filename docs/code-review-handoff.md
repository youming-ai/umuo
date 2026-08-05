# Code Review Handoff

## Scope

Reviewed the current project tree at `69f377f` plus the working-tree changes. No fixed-point commit or originating spec was supplied, so this is a whole-project review rather than a diff review.

## Executive summary

- No P0 findings.
- The test/build toolchain is green, but the app has several runtime and architecture issues that are not covered by the unit suite.
- The highest-priority fixes are SSR content delivery, live match freshness, partial upstream failure handling, and distinguishing upstream outages from 404s.

## Findings

### P1 — Core content is not SSR-rendered

**Locations:** `src/pages/index.astro:15`, `src/pages/[comp]/index.astro:21`, `src/pages/[comp]/schedule.astro:21`, and the other content pages.

All content-bearing React views use `client:only="react"`. Astro therefore emits only an `<astro-island>` placeholder; the server-computed `initialData` is serialized but not rendered as HTML. A no-JavaScript client, crawler, or failed hydration sees no news, fixtures, standings, or match detail. This also contradicts the repository's SSR/first-paint claims.

**Direction:** render the content server-side and hydrate it (`client:load`/equivalent), or explicitly accept a JS-only app and remove the SSR/SEO claim.

### P1 — Live match detail hero never updates

**Locations:** `src/hooks/useMatchDetail.ts:27-34`, `src/components/MatchDetailPage.tsx:105`, `src/components/MatchDetailPage.tsx:167-218`.

`useMatchDetail` polls the summary, but `MatchDetailPage` renders the immutable `match` prop for score, status, clock, and shootout data. `MatchDetail` does not contain a replacement `CompMatch`, so a live match page keeps its initial hero score/status indefinitely while only the tabs refresh.

The current implementation also violates the documented lifecycle: the project guidance says match detail has no interval and reload shows loading, while this hook uses `usePolledResource` with a 30-second interval and SWR reload behavior.

**Direction:** either poll scoreboard state and merge it into the hero, or remove the interval and keep match detail fetch-once/reload semantics.

### P1 — Scoreboard is discarded when standings fail

**Locations:** `src/data/api.ts:520-526`, `src/hooks/useCompetition.ts:24-31`.

Scoreboard and standings are independent upstream resources, but both server and client composition require both responses to be successful. A temporary standings 502/403 turns the entire competition view into empty data, hiding otherwise valid live scores and fixtures; the home scoreboard is affected through `getHomeView` as well.

**Direction:** transform each successful resource independently, preserve scoreboard data when standings fail, and expose standings error state separately.

### P1 — Upstream outages are returned as 404 pages

**Locations:** `src/data/api.ts:549-568`, `src/data/api.ts:408-458`, `src/pages/[comp]/match/[slug].astro:15-17`, `src/pages/[comp]/team/[id].astro:16-20`, `src/pages/[comp]/player/[id].astro:19-23`.

`getCompMatchBySlug`, `getTeamDetail`, and the player page's competition lookup collapse upstream errors into `null`/empty data. The Astro pages then set HTTP 404. A transient ESPN/KV failure consequently makes valid match/team/player URLs look permanently nonexistent to users and crawlers.

**Direction:** return a discriminated `not-found` vs `unavailable` result, or emit 503 for upstream failure while reserving 404 for confirmed missing entities.

### P2 — Empty SSR competition data is thrown away

**Locations:** `src/hooks/useCompetition.ts:11-22`, `src/components/CompetitionDataIsland.tsx:31-52`.

The hook only treats initial data as seeded when `matches.length > 0`. A legitimate off-day or standings-only response is discarded, the fallback is always soccer-shaped, and the island shows loading while issuing duplicate requests. This is especially visible for NBA off-season data.

**Direction:** seed whenever `initialData` is supplied and derive the empty fallback from the competition sport.

### P2 — Duplicate 30-second polling on pages with rails

**Locations:** `src/pages/[comp]/schedule.astro:21-23`, `src/components/CompetitionDataIsland.tsx:31`, `src/components/RightRailIsland.tsx:22`, `src/hooks/useCompetition.ts:22-31`.

The schedule page mounts both `CompetitionIsland` and `RightRailIsland hide="standings"`. The hidden rail still runs the full scoreboard+standings hook, so the active competition is fetched twice every 30 seconds, in addition to the global ticker's scoreboard fetch. Odds pages have the same center/rail duplication pattern.

**Direction:** skip competition fetching when standings are hidden, or share one competition resource between islands.

### P2 — Cache keys do not include the computed season

**Locations:** `src/data/api.ts:232-240`, `src/data/api.ts:270-321`, `src/competitions.ts:109-113`.

`standings`, `leaders`, and `leaderboards` URLs use a dynamic season, but their KV keys are only based on `comp.key` and resource name. At a season rollover, the previous season can be served as fresh/stale data (up to the 24-hour keep window), and a failed revalidation cannot distinguish the seasons.

**Direction:** include the season (or the complete upstream URL) in season-dependent cache keys.

### P2 — Successful HTTP error payloads can poison the cache

**Location:** `src/data/api.ts:197-209`, `src/data/api.ts:164-177`.

`cached()` stores every `2xx` response without validating that it is usable JSON. Parsers then turn a `200 {"error":...}` or malformed response into empty data after the bad body has already replaced the last good cache entry. `getCompNews` detects an error payload only after `serve()` has cached it.

**Direction:** validate the response/payload before writing, or make producer parsers throw on unusable upstream payloads so serve-stale remains effective.

### P2 — Global home news never revalidates in an open tab

**Locations:** `src/pages/index.astro:10-15`, `src/components/HomeView.tsx:53-60`.

`getHomeView` fetches aggregated news only during document rendering. `HomeView` polls scores through `useTicker`, but has no news hook or retry path. An initial news outage or stale feed remains blank/stale until a full navigation/reload.

**Direction:** add a global-news revalidation path or explicitly make the home feed reload-only.

### P2 — Worker type/config drift

**Locations:** `worker-configuration.d.ts:1-14`, `src/data/api.ts:83-86`, `env.d.ts:7-13`, `wrangler.jsonc:4-20`.

`bunx wrangler types --check` fails because `worker-configuration.d.ts` is out of date. The Worker also uses a hand-written `Env` interface while a generated binding file exists. In addition, `observability.enabled` is `false` even though nested logs/traces are configured as enabled, so production observability is effectively disabled.

**Direction:** regenerate/check Wrangler types in CI, use the generated binding types as the source of truth, and either enable observability or remove the misleading nested settings.

### P2 — Active documentation describes removed features

**Locations:** `README.md:26-32`, `README.md:46-86`, `README.md:143-155`, `docs/news-classification-spec.md`.

The README still documents `fifa.world`, live-stream modules, `AppProviders`, `useStreams`, `/api/news`, and `/[comp]/news`/`bracket` routes that no longer exist. The news classification document also describes an API contract that the current Worker does not expose.

**Direction:** update the active README/docs or clearly mark historical plans as archived.

### P3 — Score flash CSS references a nonexistent token

**Location:** `src/index.css:363-369`.

The animation uses `--c-chalk`, but the theme defines `--c-text`; Tailwind maps `chalk` to `--c-text`. The score flash color declarations therefore do not resolve.

### P3 — Soccer draw odds are missing from match detail

**Locations:** `src/adapters/summaryExtras.ts:29-41`, `src/components/matchdetail/OddsFormPanel.tsx:26-45`.

The scoreboard odds parser includes `drawMoneyLine`, but summary odds omit it and the match-detail odds panel never renders it. Soccer detail pages therefore lose the draw price even when ESPN supplies it.

## Verification

Passed:

- `bunx vitest run` — 43 files, 329 tests.
- `bun run typecheck` — 0 errors, warnings, or hints.
- `bun run build` — Astro check, Worker typecheck, and Astro build.
- `bun run lint`.
- `bun run format:check`.
- `bunx wrangler deploy --dry-run`.

Failed:

- `bunx wrangler types --check` — generated `worker-configuration.d.ts` is out of date.

Local preview smoke testing returned HTML 200s, but `/api/eng.1/scoreboard` returned 502 because the preview runtime received ESPN 403 responses. Direct Node requests to the same upstream endpoint succeeded, so this should be reproduced in the deployed Worker before treating it as a confirmed application defect.

## Working-tree notes

Uncommitted changes currently include:

- `.gitignore`: ignore `.dev.vars`.
- `env.d.ts`: add `GEMINI_API_KEY` typing.
- `package.json`/`bun.lock`: dependency bumps.
- `.dev.vars.example` and `docs/ai-news-aggregation-rfc.md`: new untracked files.

`bun.lock`'s workspace dependency declarations still contain the previous `lucide-react` and `postcss` ranges even though `package.json` has been bumped; run `bun install --lockfile-only` before committing those changes.

No application source fixes were applied during this review.
