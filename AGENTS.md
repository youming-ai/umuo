# Repository Guidelines

## Project Overview

**umuo** (`https://umuo.app`) is an AI-curated football news desk. A Cloudflare cron pulls ~20 RSS and JSON feeds every 15 minutes, a Gemini agent classifies and summarises each new article into D1, and an Astro SSR app renders that corpus as a full-bleed masonry board with a source / competition / topic index.

It grew out of an ESPN scoreboard app, and that half still exists: the per-competition schedule, standings, stats, teams, odds, match, team and player pages read ESPN's public APIs through a KV cache. **News is the product; the competition pages are legacy surface kept alive, not developed.** Know which half you are in before changing anything.

## Two data planes

They share `src/data/api.ts` and the KV SWR core, and nothing else.

```mermaid
graph TD
  Cron["cron */15"] --> Ingest[feeds/ingest: fetch 20 sources]
  Ingest -->|drop stored fingerprints| Q[(INGEST_QUEUE)]
  Q --> Consumer[feeds/queue: batch of 10]
  Consumer -->|one call per batch| Gemini[Gemini Interactions API]
  Consumer --> D1[(D1 umuo-content)]
  Sweep["cron 17 3"] --> Retention[feeds/retention: prune + archive]
  Retention --> D1

  Home["/ and /:comp"] --> Explore[getExploreFeed] --> KV1[(KV CACHE)] --> D1
  Comp["/:comp/schedule etc"] --> Serve[serve / serveLeaders] --> KV2[(KV CACHE)] --> ESPN[ESPN site.api]
```

**News plane (D1).** `ingestAllSources` fans out over `FEED_SOURCES`, normalises to `RawArticle`, drops anything whose fingerprint is already stored, and enqueues the rest. The consumer re-checks for duplicates, sends whatever survives as **one** Gemini interaction, then writes each article, its tags and one `agent_runs` row. Reads go through `getExploreFeed` / `getExploreFilters`, cached in KV.

**Competition plane (ESPN).** `serve(comp, resource, …)` fetches ESPN and caches the body in KV with stale-while-revalidate. `src/adapters/` normalises the raw JSON into `kind: 'soccer' | 'basketball'` domain types. React islands poll `/api/:comp/:resource` through `usePolledResource`.

## Architecture notes

- **SSR, no client router.** Every view is an independent document. Navigation is `<a href={pathFor(...)}>`; there is no history API in play. Anything an island renders must be identical on the server and at hydration — times go through `LocalTime` (SSR in UTC, re-formatted after mount).
- **KV SWR core** (`runCached`): fresh window → `HIT`, in-flight coalescing via a module-level `Map`, upstream failure serves stored stale data as `STALE` or 502. Emits `x-cache`.
- **Chrome ownership.** `Layout.astro` is the shell; `showTicker` / `showHeader` opt out of the sticky bars. The explore pages pass `showHeader={false}` because `ExploreView` carries the wordmark and theme switcher in its own toolbar. Competition pages use the `left` slot for `LeftNav`.
- **Registries are the source of truth.** `src/competitions.ts` (leagues, capability flags, season maths), `src/sections.ts` (which sections exist, their suffix and gate — drives `LeftNav`, `router.ts`, `sitemap.xml.ts`), `src/feeds/sources.ts` (feeds), `src/site.ts` (canonical origin for canonical/og/sitemap). Adding a soccer league is registry-only.

## Key directories

- `src/pages/` — `/` (news home), `/[comp]` (news, per competition), `/[comp]/{schedule,stats,teams,odds,transactions}`, `/[comp]/{match/[slug],team/[id],player/[id]}`, `api/[...route].ts`, `sitemap.xml.ts`.
- `src/feeds/` — the news pipeline. `sources.ts` (registry), `ingest.ts` (cron side), `rss.ts`, `queue.ts` (consumer), `gemini.ts` (model I/O), `enrich.ts` (dedupe + write), `retention.ts` (sweep + `PRUNE_CRON`).
- `src/data/api.ts` — KV core, ESPN pipelines, explore queries, SSR composers. The largest file in the repo; both planes live here.
- `src/components/explore/` — `ExploreView` (rail, toolbar, masonry, infinite scroll), `ExploreCard`. Everything else under `src/components/` belongs to the competition plane.
- `src/adapters/`, `src/hooks/` — competition plane only.
- `migrations/` — D1 schema. Applied by `bun run deploy`, never automatically.
- `worker/entrypoint.ts` — `fetch` (Astro), `scheduled` (cron), `queue` (consumer). `worker/index.ts` is the `/api/*` dispatcher.

## Commands

Bun locally, `workerd` in production.

- `bun run dev` — Astro dev server with local Miniflare KV + D1.
- `bun run build` — `astro check && tsc -p tsconfig.worker.json && astro build`.
- `bun run typecheck` / `lint` / `format` — app + worker types, Biome.
- `bunx vitest run` — full suite. `bunx vitest run <file>`, `-t "<name>"` to narrow.
- `bun run deploy` — **migrations then deploy**. Workers Builds must be configured to run this, not bare `wrangler deploy`, or migrations silently never apply.
- `bunx wrangler d1 execute umuo-content --remote --command "…"` — inspect production data.

## Infrastructure

| | |
|---|---|
| Worker | `umuo`, deployed by Workers Builds from `main` |
| KV | `CACHE` `1ec03cc0…` |
| D1 | `DB` → `umuo-content`, primary region **APAC** (cannot be moved without recreating) |
| Queue | `INGEST_QUEUE` → `umuo-news-ingest`, batch 10, DLQ `umuo-news-ingest-dlq` (no consumer — messages that land there are invisible) |
| Crons | `*/15 * * * *` ingest, `17 3 * * *` retention sweep |
| Secret | `GEMINI_API_KEY` (`wrangler secret put`) |

## Conventions

- **Biome 2.5.1**: 2-space, single quotes, semicolons, trailing commas, 100 cols, arrow parens always. Excludes `*.css`, `dist`, `.astro`, `worker-configuration.d.ts` (generated by `wrangler types`; regenerate rather than hand-edit).
- **Naming**: PascalCase components and layouts, `*Island.tsx` for hydration wrappers, camelCase hooks and utilities, tests colocated as `<name>.test.ts(x)`.
- **Defensive ESPN parsing**: untyped upstream JSON goes through `src/utils/coerce.ts` (`obj`, `arr`, `str`, `teamLogo`) and `parseScore`. ESPN omits fields without warning.
- **Cancellation**: network calls bind an `AbortController`; hooks abort on unmount and key change and poll only when `document.visibilityState === 'visible'`.
- **Degrade, don't crash**: SSR composers return empty arrays on failure. Hooks swallow `AbortError` and keep the last good state.
- **Copy is English**; Chinese comments explaining non-obvious logic are kept when editing around them.
- **Commits** carry `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Testing

Vitest 4, `jsdom`, `globals: true`, `fileParallelism: false` (tests mutate global fetch and location). `worker/index.test.ts` overrides with `// @vitest-environment node`.

Patterns: `@testing-library/react` for components, `renderHook` with a mocked `globalThis.fetch` for hooks, direct `GET` / `onRequest` invocation for Astro routes and middleware, Map-backed KV and a `fetchMock` for edge semantics.

**A passing suite is not evidence code runs.** Seven pre-pivot modules kept green suites long after nothing imported them. When you delete a module, delete its tests, then walk imports from every route, `middleware.ts` and `worker/entrypoint.ts` to see what else is orphaned.

## Gotchas

Each of these cost real debugging. They are not hypothetical.

- **ESPN allow-lists user agents by name.** `curl/*`, `python-requests/*` and `Go-http-client/*` are served; a browser UA, *no* UA at all, `Wget`, `node` and an honest `umuo-football-news/1.0` all get 403. Both call sites send `curl/8.7.1` (`ESPN_HEADERS` in `src/data/api.ts`, `API_JSON_HEADERS` in `src/feeds/ingest.ts`) and cross-reference each other. If competition pages go blank, check this first.
- **Explore cursors are keyset, not offsets** — `<published_at>:<id>`. The feed has rows inserted at the top every tick, so an offset slides the window under the reader. Type guards on `ExploreFeed.nextCursor` must say `string`; when one said `number`, every SSR page silently reported the feed exhausted.
- **`PRUNE_CRON` is duplicated in `wrangler.jsonc`** because a Worker cannot read that file. `retention.cron.test.ts` holds them together. Anything that is not `PRUNE_CRON` is treated as an ingest tick, so a stray third schedule means an extra full fan-out.
- **Never DELETE from `articles`.** Retention archives instead: dropping a row takes its `canonical_url` and `fingerprint` with it, and the next tick re-ingests and re-enriches the same story. Deletion costs Gemini calls.
- **Dedupe before the model, not after.** `ingestAllSources` filters stored fingerprints before enqueueing and the consumer re-checks before calling Gemini. Both matter: without them a tick re-enqueues every article in every feed.
- **Explore cache keys embed the query.** Free-text `q` bypasses KV entirely — it is user-controlled and unbounded, and caching it let anyone write KV keys without limit. Cursors are re-serialised from their parsed form for the same reason.
- **Durable Objects break PR builds.** Workers Builds runs `wrangler versions upload` for preview branches, which cannot apply a DO migration. The queue consumer calls its functions directly for this reason.
- **`wrangler dev --remote` does not support Queues** and returns 1042 on the scheduled endpoint. To trigger an ingest by hand, set a one-shot cron, deploy, let it fire, then remove it.
