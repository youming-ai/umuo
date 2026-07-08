# ESPN-Grounded App Shell Layout — Design Spec + Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the open tasks. Steps use checkbox (`- [ ]`) syntax. Tasks already shipped this session are pre-checked (`- [x]`) with the file that proves them.

**Goal:** Give every route a shared four-region app shell — a live-score ticker, a sticky header, an asymmetric three-column main, and a light footer — modeled on the practical bones of `https://global.espn.com/` but expressed entirely in StreamCup's existing rounded "Apple Sports" glass design system. After the SSR peel, the app had no global chrome at all (the old SPA `Header`/nav were deleted). This shell restores navigation and adds the right-rail + ticker the peel left as loose components.

**Status:** The shell is built and verified this session (`astro build` clean, SSR HTML checked on every route type). Remaining items are enhancements, tracked as open tasks at the bottom.

---

## Part 1 — Design Spec

### Grounding

- **Subject:** StreamCup — a live-stream + fixtures hub for the 2026 World Cup, the Premier League, and the NBA.
- **Audience:** fans who want to *watch a match live now* or check *what's next / who's top* with minimum friction.
- **The page's one job:** route the fan to a live stream or the next fixture in as few moves as possible.
- **Reference vs identity:** ESPN supplies the *structure* (four regions, 3-column main). StreamCup's *look* is fixed and unchanged — rounded glass surfaces, pitch-green/live-red on near-black. We take ESPN's skeleton and drop its density (ad banner, equal columns, hairline rules, link-farm footer), because those betray the "one fast, no-clutter hub" positioning.

### Color — "Floodlit Midnight" (evolved from the original broadcast-dark tokens)

The visual direction chosen for this shell. It keeps the token architecture (all values in `src/index.css`, mapped in `tailwind.config.js`), keeps pitch-green + live-red, and re-grounds the app in a **midnight blue-green** lit by a **sodium floodlight glow** — the aesthetic of a night match under stadium lights.

| Token | Role | Dark `R G B` | Hex |
|-------|------|--------------|-----|
| `--c-bg` / `night` | page ground (midnight blue-green, not black) | `11 20 24` | `#0B1418` |
| `--c-surface` / `panel` | glass cards, header, ticker | `22 33 28` | `#16211C` |
| `--c-surface2` / `panel2` | insets, logos | `34 50 45` | `#22322D` |
| `--c-line` / `line` | hairline borders (`/30` alpha) | `42 58 52` | `#2A3A34` |
| `--c-text` / `chalk` | primary text (chalk white) | `234 244 238` | `#EAF4EE` |
| `--c-muted` / `chalkdim` | secondary text, labels | `130 146 142` | `#82928E` |
| `--c-pitch` | brand accent (logo mark, positive) | `46 213 115` | `#2ED572` |
| `--c-live` | live tally light, ticker dot | `255 69 58` | `#FF453A` |
| `--c-amber` | halftime / caution badge | `251 191 36` | `#FBBF24` |
| `--c-sodium` | **floodlight glow — the signature accent** | `244 183 64` | `#F4B740` |

Light theme keeps its paper ground (a *day* match — no floodlights); it gains `--c-sodium` as a muted warm amber and the floodlight glow is suppressed (`.ds-floodlight { display:none }` in light). Not the AI-default cream/terracotta or acid-green-on-black: a **night-match palette** — pitch green + a live tally light + a sodium glow on a midnight studio ground.

### Type — fixed, from `tailwind.config.js` (loaded in `Layout.astro`)

- **Display — `Saira Condensed` (600/700):** condensed, used for the logo, nav, section headers, scores. Reads as a TV lower-third / scoreboard, not a generic serif. Used with restraint (nav + headings + numerals only).
- **Body — `Hanken Grotesk` (400):** news copy, descriptions.
- **Utility — mono (`ui-monospace`):** captions, labels, clocks, standings numerals — anything tabular. The `ds-caption` / `ds-micro` classes are the only entry points.

### Layout — the actual design decision

ESPN's four regions, re-expressed as StreamCup chrome:

| ESPN region | StreamCup expression | Data source |
|-------------|---------------------|-------------|
| ① Top ad/scores banner | **Live-score Ticker** (signature) | `useStreams` (ppv.st, cross-comp, browser-only) |
| ② Nav header | sticky Header: logo + competition switcher (`ds-segmented`) + News + theme | `COMPETITIONS`, current URL |
| ③ 3-column main | **asymmetric** `[13rem · fluid · 20rem]` grid | per-page |
| ③-left | LeftNav — section links (Matches/Scorers/Bracket), capability-gated | `COMPETITIONS[comp].capabilities` |
| ③-center | page content (fixtures / news / match detail / team / player) | SSR seed + island |
| ③-right | RightRail — Live Streams / Standings / Leaders | `useCompetition` + `useStreams` |
| ④ Site-directory footer | **light** footer: provenance only (Data: ESPN · Streams: ppv.st · ©) | static |

Grid template adapts to the slots a page fills (`Astro.slots.has`):
- both rails → `lg:grid-cols-[13rem_minmax(0,1fr)_20rem]`
- right only / left only → the matching 2-col
- no rails → no grid, page keeps its own width + padding (news/legacy pages need zero change)

### Wireframes

```
Desktop (≥lg)                                     Mobile (<lg)
┌──────────────────────────────────────────────┐  ┌──────────────────┐
│ ● LIVE  ARG 1-0 EGY 67' · BRA–GER 20:00 · →   │  │ ● LIVE ARG1-0 →  │ ticker
├──────────────────────────────────────────────┤  ├──────────────────┤
│ StreamCup [World Cup][EPL][NBA][News]      ☀  │  │ StreamCup     ☀  │ header
├────────┬───────────────────────┬──────────────┤  │ [Matches][Scor..]│ left→chips
│ Matches│ ┌─── HERO / fixtures ─┐│ ● Live Streams│  ├──────────────────┤
│ Scorers│ └─────────────────────┘│ ──────────────│  │  content         │ center
│ Bracket│ ┌fixture┐ ┌fixture┐    │ Standings     │  │                  │ (rails
│(sticky)│ ┌fixture┐ ┌fixture┐    │ Leaders(stick)│  │                  │  hidden)
├────────┴───────────────────────┴──────────────┤  ├──────────────────┤
│ StreamCup · Data ESPN · Streams ppv.st · ©2026 │  │ footer           │
└──────────────────────────────────────────────┘  └──────────────────┘
```

### Signature — the floodlight glow + the live-score Ticker

**Floodlight glow (the identity).** A single static sodium glow (`--c-sodium`) fixed above the top of the page, fading down into the midnight ground — as if the pitch is lit from overhead by stadium floods (`.ds-floodlight` in `index.css`, dark theme only, no motion). It is the one atmospheric flourish; everything below it stays quiet. This is what makes the shell unmistakably "Floodlit Midnight" rather than generic dark mode.

**Live-score Ticker (the functional hero).** A persistent live-score strip pinned above the header where ESPN puts an ad. It is *the live matches themselves* — carries the `live-dot` tally light (the one repeating animation on the page), scrolls horizontally, and renders `null` when nothing is live or upcoming (no empty band). Honest to the product's thesis in a way an ad banner never is.

Boldness is spent in these two coordinated places (both at the top, both about "live under lights"); the three columns below are disciplined and calm.

### Responsive

- `<lg`: both rails' `<aside>` — left becomes a horizontal scrolling chip row under the header (section nav survives on mobile); right rail is hidden (secondary info). Ticker stays (horizontal scroll is native to it). Center goes full width.
- Header nav and section nav are real `<a href>` links (each route is a distinct Astro SSR page — client `pushState` can't swap the server-rendered page). Client routing is reserved for in-island state (news scope, fixture filters).
- Quality floor: visible keyboard focus (`--c-pitch` outline, already in `index.css`), `prefers-reduced-motion` respected (`live-pulse` gated), body-level single scroll container.

### Copy

- Header: real competition names ("World Cup", "Premier League", "NBA") — not slugs, not "Comp 1".
- Ticker upcoming items show local kickoff time; live items show the tally light. No "LIVE!!!" hype.
- Empty right-rail streams: "No live matches streaming right now." — states the fact, no apology.
- Footer names what the data *is* ("Data: ESPN", "Streams: ppv.st"), not how it's fetched.

### Critique against generic defaults

A generic "3-column sports portal" collapses to ESPN itself: equal-width columns, hairline rules, dense boxes — exactly the AI broadsheet default (look #3). StreamCup diverges on four axes, none of which cost extra: **(1)** asymmetric columns with `gap-6` breathing room; **(2)** rounded glass cards floating on the pitch-dark ground instead of ruled boxes; **(3)** the top region is a live ticker, not an ad or a hero-number cliché; **(4)** a light provenance footer, not a link farm. Color and type were already subject-grounded and non-default, so the freedom left by the brief is spent entirely on layout structure — the one axis the brief actually left open.

---

## Part 2 — Implementation Plan

### Tech stack

Astro 5 + `@astrojs/cloudflare`, React 18 islands, Tailwind (token-mapped), TypeScript, Vitest. **No new dependencies.** All color/type/spacing from existing tokens.

### File structure

- Create: `src/components/Ticker.tsx` (+`Ticker.test.ts`) — signature live-score island
- Create: `src/components/Header.astro` — sticky nav chrome
- Create: `src/components/Footer.astro` — light footer
- Create: `src/components/LeftNav.astro` — section nav (responsive)
- Create: `src/components/RightRailIsland.tsx` — self-fetching wrapper around existing `RightRail.tsx`
- Create: `src/components/ThemeToggle.tsx` — provider-wrapped `ThemeSwitcher` island
- Modify: `src/layouts/Layout.astro` — the four-region shell with slot-adaptive grid
- Modify: `src/pages/[comp]/{index,scorers,bracket}.astro` — fill left + right slots
- Modify: `src/pages/[comp]/{match/[slug],team/[id]}.astro`, `src/pages/player/[id].astro` — fill slots
- Modify: `src/components/FixturesView.tsx` — drop self-padding (shell owns width now)

### Global constraints

- **Colors only through tokens.** The Floodlit Midnight retune lives entirely in `src/index.css` `:root`/`[data-theme]` channels + the one new `--c-sodium` token (mapped in `tailwind.config.js`). No hardcoded hex/`rgba()` in components. Type, radii, and shadows are unchanged.
- **No double width/padding.** Shell owns width + page padding *only when a page has rails*; rail-less pages keep their own wrapper untouched.
- **No extra SSR fetch for rails.** Comp pages seed `RightRailIsland` from the `initialData` the center island already fetched; team/player reuse their `getCompetitionView` result; match omits the rail.
- **All existing tests stay green; `astro build` stays green.**

### Tasks

#### Task 1 — Signature: live-score Ticker  ✅
- [x] **Step 1: `Ticker.tsx`** — `useStreams`, pure `selectTickerMatches(matches, nowSec)` (live-first then next 10 upcoming by kickoff), `live-dot` for live / local time for upcoming, `null` when empty. *(built)*
- [x] **Step 2: `Ticker.test.ts`** — live-vs-upcoming ordering + finished-drop + 10-cap. *(2 tests pass)*

#### Task 2 — Header + theme  ✅
- [x] **Step 1: `ThemeToggle.tsx`** — wraps `ThemeSwitcher` in `AppProviders` so it mounts standalone. *(built)*
- [x] **Step 2: `Header.astro`** — logo (`Stream`+pitch `Cup`), competition switcher via `ds-segmented`/`ds-seg-tab`, News link, `aria-current` active state from `Astro.url`, theme island. *(built)*

#### Task 3 — LeftNav + Footer  ✅
- [x] **Step 1: `LeftNav.astro`** — capability-gated section links (`<a href>`), optional `active`, vertical sticky on `lg` / horizontal chip row `<lg`. *(built)*
- [x] **Step 2: `Footer.astro`** — light provenance footer. *(built)*

#### Task 4 — RightRail island  ✅
- [x] **Step 1: `RightRailIsland.tsx`** — self-fetching (`useCompetition(comp, initialData?)` + `useStreams`), builds `streamIndex`/`watchableSlugs`, renders existing `RightRail`. `initialData` optional (team/player self-fetch). *(built)*

#### Task 5 — The shell + page wiring  ✅
- [x] **Step 1: `Layout.astro`** — Ticker + Header + slot-adaptive grid (`Astro.slots.has`) + Footer; `comp` + `title` props. *(built)*
- [x] **Step 2: comp pages** — `index`/`scorers`/`bracket` fill left (`LeftNav`) + right (`RightRailIsland`, seeded). *(built)*
- [x] **Step 3: team/player** — left + right (right seeded from `getCompetitionView`). *(built)*
- [x] **Step 4: match** — left only (no right rail — protect video width → 2-col). *(built)*
- [x] **Step 5: `FixturesView.tsx`** — drop `ds-page`/max-w wrapper. *(built)*

#### Task 6 — "Floodlit Midnight" restyle  ✅
- [x] **Step 1: retune dark tokens** — `--c-bg`/`surface`/`surface2`/`line`/`text`/`muted` to the midnight blue-green scale; `--c-on-accent` follows the new ground. *(`index.css`)*
- [x] **Step 2: add `--c-sodium`** — dark `244 183 64`, light `214 150 40`; mapped as `sodium` in `tailwind.config.js`. *(built)*
- [x] **Step 3: signature `.ds-floodlight`** — fixed top sodium radial glow, dark-only, no motion; wired into `Layout.astro` behind a `relative z-10` content wrapper. *(built)*

#### Task 7 — Deferred enhancements  ⏳ (open)
- [ ] **Ticker click-through** — map each ticker item to its fixture (needs the per-comp stream index the global ticker doesn't hold); make items link to `/:comp/match/:slug`. Currently display-only.
- [ ] **News right rail** — a news-appropriate rail (trending / most-read) for `/news/*`, which is cross-competition and has no comp rail today. Design it before building; don't force the comp rail onto news.
- [ ] **Mobile right rail access** — a "More" disclosure below content on `<lg` so Standings/Leaders/Streams aren't fully unreachable on phones (currently `hidden`).
- [ ] **Ticker auto-scroll (optional)** — only if the strip regularly overflows; must respect `prefers-reduced-motion`. Skipped by default (extra motion reads as AI-generated).

### Verification

- [x] `astro check` + `tsc -p tsconfig.worker.json` → 0 errors.
- [x] `astro build` → clean, all islands emitted.
- [x] `Ticker.test.ts` → 2/2; biome clean on new `.tsx`.
- [x] SSR HTML smoke: comp page = 3-col + LeftNav + RightRail + Ticker + Footer, active tab highlighted; match = 2-col (no right rail); news = chrome only, no grid, own category nav; team/player = 3-col.
- [ ] Live visual pass (screenshot) — pending a browser environment; ticker needs runtime ppv.st data to render.
