# umuo → Astro Migration — Design Spec

**Date:** 2026-07-08
**Status:** Approved design (brainstormed); implementation to follow via writing-plans.

## Goal

Migrate umuo (currently a Vite + React 18 SPA) to **Astro** used as an **SSR/SEO shell with React islands**, to fix the SPA's core weakness — no server-rendered content, hence poor SEO for a public news/sports-data site — while preserving all existing interactivity and real-time behavior. Runtime stays Cloudflare Workers; the existing `worker /api/*` edge cache stays.

The chosen skill is `astro` from `youming-ai/bun-ts-stack-skills`, used for its SSR + islands architecture (NOT its content-collections feature — umuo's content is remote ESPN data, not local markdown). Auth/DB/email/monitoring parts of that stack are **not adopted** (umuo has no auth and no database).

## Locked decisions (from brainstorming)

1. **In-place refactor, same repo** — swap Vite for Astro inside the current repo; new `src/pages/*.astro` SSR shells; existing React components become islands; `worker/api` retained; git/PR history continues.
2. **Skeleton-first, page-by-page** — stand up the Astro build + layout/routing skeleton, mount the whole current SPA as a single catch-all island so the site runs uninterrupted, then peel pages out into real SSR one at a time (news first — biggest SEO win).
3. **SSR first paint + island takeover; unified data layer** — SSR renders first-paint HTML server-side (SEO + fast); client islands take over interactivity and real-time polling via the existing SWR hooks against `/api`. SSR and client share ONE data layer (KV cache + adapters + competitions/buildUrl).
4. **i18n + theme via cookie** — server reads a cookie to render correct `lang`/`data-theme` on first paint (no FOUC); URL structure unchanged (no `/:lang` prefix — umuo's translatable surface is only UI chrome; news/scores data is English, so per-language URLs don't earn their complexity).

## §1 Architecture + data layer

```
Astro (Cloudflare adapter, SSR) — replaces Vite in-place
  src/pages/*.astro          SSR shells, prerender=false, render first paint server-side
     └─ call shared data functions → full HTML (SEO + first paint)
     └─ mount React islands (client:load / client:visible)
  React islands (existing components)  hydrate → take over interaction + real-time polling
     └─ existing SWR hooks poll /api for live updates
  worker /api/*  (retained)  data endpoints for client islands
        ↑ both share ONE stack: KV cache + adapters + competitions/buildUrl
```

**Unified data layer** is the linchpin. Extract the fetch+cache logic currently in `worker/index.ts` (`runCached`/`serve`/`serveSummary`/`serveLeaders`/`serveNews` + adapter parsing) into a set of **reusable data functions** with two consumers:

- **SSR pages** (Astro, running on the Cloudflare Worker) access KV via `Astro.locals.runtime.env.CACHE` and call the data functions directly to produce first-paint HTML — fetch, parse, and render all server-side.
- **client islands** keep hitting `/api/*` (existing worker endpoints) with the existing SWR hooks to poll real-time updates (scores/live/streams).

ESPN parsing (`adapters`/`competitions`/`leaders`/`newsFeed`) is defined once and shared by SSR and client, so the two never drift. `worker/index.ts` becomes a thin HTTP wrapper over the shared data functions.

## §2 Routing

Custom History-API router → Astro **file-based routing**:

| Current route | Astro page file |
|---|---|
| `/:comp` (matches) | `src/pages/[comp]/index.astro` |
| `/:comp/scorers`, `/bracket` | `src/pages/[comp]/scorers.astro`, `bracket.astro` |
| `/:comp/match/:slug` | `src/pages/[comp]/match/[slug].astro` |
| `/:comp/team/:id`, `/player/:id` | `src/pages/[comp]/team/[id].astro`, `player/[id].astro` |
| `/news`, `/news/:sport` | `src/pages/news/index.astro`, `[sport].astro` |
| `/news/league/:slug`, `/news/team/:abbrev` | `src/pages/news/league/[slug].astro`, `team/[abbrev].astro` |

- **Static segments beat dynamic** (Astro native): `/news` resolves to `news/index.astro`, never falls into `[comp]` — this removes the Phase-2 "news is a comp-less top-level route" conflict and the nominal-comp workaround is no longer needed.
- `[comp]` still validates against known competition keys (reuse the `COMPETITIONS` check from `parseRoute`); unknown → Astro 404.
- **Navigation switches from client-side History to real `<a href>`** (SSR per page). `pathFor` is retained to generate hrefs; islands no longer use the custom `navigate()` / `app:routechange` event. Add Astro **`<ClientRouter/>` (View Transitions)** for SPA-like smoothness on top of SSR.
- Legacy unprefixed links (`/scorers`) → **Astro middleware redirect** to the default competition (move the existing `canonicalPath` logic into middleware).

## §3 i18n + theme (SSR via cookie)

Current `detectLanguage` (localStorage → navigator) and theme (localStorage) are client-only, causing lang/theme **FOUC** under SSR. Fix by making the server aware:

- **theme** → cookie. SSR reads the cookie and emits the correct `data-theme` on the root, zero FOUC. Client theme toggle writes the cookie (and updates the root attribute).
- **i18n** → cookie (NOT URL prefix). SSR reads the cookie (falling back to `Accept-Language`, then default) to render UI in the right language. `LanguageProvider`/`ThemeProvider` change from "client-only detection" to "receive an SSR-provided initial value + client changes write the cookie". Rationale: umuo's translatable surface is UI chrome only (scores/news data is English), so per-language URLs would add routing complexity without real multilingual-content SEO.

`messages.ts` (flat key→string per language) and the 4-language parity test are unchanged.

## §4 Migration sequence + islands boundary

**Sequence** (skeleton-first, news-first; each peel removes that route from the catch-all):

1. **Skeleton** — install Astro + Cloudflare adapter replacing Vite; `Layout.astro` (head + cookie-driven `data-theme`/`lang`); mount the whole current SPA as one catch-all island `src/pages/[...all].astro` with `<App client:only="react">`. Site runs uninterrupted (all pages still SPA, now inside the Astro/SSR shell).
2. **Unified data layer** — extract `runCached`/`serve*` + adapters into shared data functions callable from SSR (`Astro.locals.runtime.env.CACHE`) and from the retained `worker /api`.
3. **Peel pages into SSR, news first**: news (`/news`, `/news/:sport`, `league`, `team`) → then competition pages (`/:comp` matches/scorers/bracket) → then match detail → then team/player. Each renders first paint server-side; the interactive View becomes an island.
4. Once the catch-all is empty, delete the old SPA entry.

**Islands boundary**: existing **View components become islands as a whole** (`client:load`/`client:visible`). Astro renders the React island's HTML server-side then hydrates it — so a whole-View island already gives first-paint content (SEO ✓) plus hydration-time takeover, without shattering components into fragments.

Supporting changes (focused, bounded):
- **hooks gain `initialData`** — SSR first-paint data is passed into the island as the SWR seed, so the client skips the first fetch, avoids a flash, and then polls as usual.
- **providers receive SSR initial values** — `LanguageProvider`/`ThemeProvider` take an SSR-provided lang/theme and write cookies on client change.
- **navigation → `<a href>`** (`pathFor`) + Astro `<ClientRouter/>`.

## Reuse vs change inventory

**Reused mostly as-is:** ~40 React components, `src/utils/*`, `src/adapters/*`, `src/competitions.ts`, `src/leaders.ts`, `src/newsFeed.ts`, `src/streamSources.ts`, `src/i18n/messages.ts`, `worker` core logic.

**Changed:**
- Build: Vite config → Astro config (+ Cloudflare adapter); `package.json` scripts.
- Data layer: extract shared data functions from `worker/index.ts`; SSR + `/api` both consume them.
- Hooks (`useCompetition`/`useLeaders`/`useMatchDetail`/`useBracket`/`useNews`/`useStreams`): add `initialData` seeding.
- Providers (`i18n`, `theme`): SSR initial value + cookie persistence.
- Router (`utils/router.ts`): `pathFor` retained for hrefs; custom `navigate`/History/`useRouter` retired in favor of Astro routing + `<a>`; `parseRoute`'s comp validation reused in `[comp]` pages + middleware.

**New:** `src/pages/**/*.astro`, `src/layouts/Layout.astro`, `src/middleware.ts`, `astro.config`, cookie helpers.

## Non-goals / out of scope

- No Better Auth, no PostgreSQL/Drizzle/Hyperdrive, no Resend/Sentry (umuo has no auth/DB; adopt later only if a real need appears).
- No Astro content collections (content is remote ESPN data, not local markdown).
- No URL language prefix (cookie-based i18n per §3).
- Unrelated feature work (Phase-4 PWA, in-app article reader, cross-sport marquee) is out of scope for the migration.

## Risks / notes

- **SSR-from-Worker reachability**: SSR pages fetch ESPN server-side from the Cloudflare Worker runtime — same reachability the leaders pipeline already relies on (proven in dev/node; confirm on Cloudflare preview during skeleton/data-layer phases).
- **View-as-island first paint**: relies on the View components rendering safely server-side (no unguarded `window`/`document`/`localStorage` at module/render top-level). Audit each View when peeling it; providers moving to SSR initial values removes the main offender.
- **`/api` auth/rate-limit** remains unhandled (tracked from Phase 1) — orthogonal to this migration; address at Cloudflare WAF before public launch.
- **Scope**: this spec is one coherent architecture; implementation will be **multiple plans** (skeleton, unified data layer, then one per page group), each independently shippable — the catch-all island keeps the site live throughout.
