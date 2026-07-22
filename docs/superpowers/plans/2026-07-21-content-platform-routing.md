# Content-Platform Routing Pivot + World Cup Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure routing into an ESPN-style content platform (global news-first home, per-competition news hubs, schedule as a sub-page) and retire the finished 2026 World Cup along with the bracket feature only it used.

**Architecture:** Astro SSR pages + React islands, competition registry in `src/competitions.ts`, thin URL router in `src/utils/router.ts`, edge-cached data layer in `src/data/api.ts`. Changes are: delete bracket + `fifa.world`; make `/<comp>` a news hub and move fixtures to `/<comp>/schedule`; add a real `/` home reusing the already-cross-comp `Ticker` for scores plus a new aggregated-news SSR helper.

**Tech Stack:** Astro 7, React 19 islands, Cloudflare Workers + KV, Vitest/jsdom, Biome.

## Global Constraints

- Colors only through `--c-*` tokens / Tailwind semantic colors — no hex/`rgba()`. `bg-white/5`-style overlays OK.
- Biome: 2-space indent, single quotes, semicolons, trailing commas, width 100.
- Data through the existing `src/data/api.ts` cache layer — no new backend, no new dependency.
- `bun run typecheck` (app+worker) and `bunx vitest run` must be green at the end of every task.
- Preserve Chinese inline comments when editing nearby code.
- Commit trailer on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

### Task 1: Remove the bracket feature

Bracket is used only by `fifa.world`. Delete it wholesale so Task 2 (registry removal) has nothing dangling.

**Files:**
- Delete: `src/pages/[comp]/bracket.astro`
- Delete: `src/components/BracketView.tsx`, `src/components/BracketView.test.tsx`
- Delete: `src/hooks/useBracket.ts`, `src/hooks/useBracket.test.ts`
- Delete: `src/data/bracketSeeding.ts`, `src/data/bracketSeeding.test.ts`
- Modify: `src/utils/router.ts` (drop `'bracket'` from `Section`, `SECTION_SUFFIX`, `parseView`)
- Modify: `src/components/FixturesView.tsx` (drop `BracketView` import + the `effectiveSection`/bracket branch)
- Modify: `src/components/LeftNav.astro` (drop the bracket nav item)
- Modify: `src/pages/sitemap.xml.ts` (drop the `capabilities.bracket` line)
- Modify: `src/competitions.ts` (remove `bracket` from the `capabilities` interface and from `eng.1`/`nba`)

**Interfaces:**
- Produces: `Section` union no longer contains `'bracket'`; `Competition.capabilities` no longer has `bracket`.

- [ ] **Step 1: Delete the bracket files**

```bash
git rm src/pages/\[comp\]/bracket.astro \
  src/components/BracketView.tsx src/components/BracketView.test.tsx \
  src/hooks/useBracket.ts src/hooks/useBracket.test.ts \
  src/data/bracketSeeding.ts src/data/bracketSeeding.test.ts
```

- [ ] **Step 2: Remove `'bracket'` from the router**

In `src/utils/router.ts`:
- In `Section`, delete `| 'bracket'` (the union member).
- In `SECTION_SUFFIX`, delete the `bracket: '/bracket',` line.
- In `parseView`, delete the two-line block:
  ```ts
  if (seg.length === 1 && seg[0] === 'bracket')
    return { kind: 'section', comp, section: 'bracket' };
  ```

- [ ] **Step 3: Remove the bracket branch from `FixturesView.tsx`**

- Delete the `import BracketView from './BracketView';` line.
- Delete the `groups` line if it is only used by the bracket branch (keep it if the standings block below still uses `standings.kind === 'soccer' ? standings.groups`; check usage — the standings render uses `standings` directly, so `const groups = …` becomes unused → remove it).
- Delete the `effectiveSection` computation and the `caps` lookup it depends on if `caps` is otherwise unused.
- Replace the render branch:
  ```tsx
  {effectiveSection === 'bracket' ? (
    <BracketView groups={groups} matches={matches} />
  ) : (
    …fixtures+standings…
  )}
  ```
  with just the `…fixtures+standings…` body (unwrap the ternary, keep the else branch).

- [ ] **Step 4: Remove bracket from nav, sitemap, capabilities**

- `src/components/LeftNav.astro`: delete the block
  ```ts
  ...(caps?.bracket
    ? [{ section: 'bracket' as Section, label: 'Bracket', href: `/${comp}/bracket` }]
    : []),
  ```
- `src/pages/sitemap.xml.ts`: delete `if (c.capabilities.bracket) paths.push(`/${c.key}/bracket`);`
- `src/competitions.ts`: delete `bracket: boolean;` from the `capabilities` interface, and remove `bracket: true`/`bracket: false,` from every competition's `capabilities`.

- [ ] **Step 5: Typecheck + tests**

Run: `bun run typecheck && bunx vitest run`
Expected: PASS. If any non-deleted test references `'bracket'` or `BracketView`, remove that assertion (grep: `grep -rn "bracket\|Bracket" src`). Only WC-related bracket references should remain, and those go in Task 2.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(routing): remove the World Cup-only bracket feature

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Remove the World Cup from the registry

**Files:**
- Modify: `src/competitions.ts` (delete `fifa.world` entry; `DEFAULT_COMPETITION = 'eng.1'`)
- Modify: every test that hardcodes `'fifa.world'` — re-point to `eng.1` (soccer) or `nba`
- Modify: `src/competitions.test.ts` (delete WC-specific cases)

**Interfaces:**
- Produces: `COMPETITIONS` keys are `eng.1`, `nba` only; `DEFAULT_COMPETITION === 'eng.1'`.

- [ ] **Step 1: Edit the registry**

In `src/competitions.ts`:
- Delete the entire `'fifa.world': { … },` object from `COMPETITIONS`.
- Change `export const DEFAULT_COMPETITION = 'fifa.world';` → `export const DEFAULT_COMPETITION = 'eng.1';`
- Leave the now-unused `dates` / `standingsLevel` / `shape: 'tournament'` interface fields in place (adapters branch on `shape`). Add above the `shape` field:
  ```ts
  // ponytail: 'tournament' shape + dates/standingsLevel are now unused (World Cup
  // removed 2026-07). Prune with the adapter tournament branches if another
  // tournament is never added.
  ```

- [ ] **Step 2: Re-point WC references in tests**

Find them: `grep -rln "fifa\.world" src worker`
For each hit, replace the competition key/fixture with `eng.1` (soccer detail/news/standings tests) or `nba`, whichever the test's data shape matches. Specifically:
- `worker/index.test.ts`: `COMPETITIONS['fifa.world']` → `COMPETITIONS['eng.1']`; KV keys `fifa.world:*` / `summary:fifa.world:*` → `eng.1:*`.
- `src/middleware.test.ts`: `/fifa.world/scorers` etc. → `/eng.1/…`.
- `src/hooks/useMatchDetail.test.ts`: `'fifa.world'` → `'eng.1'`, URLs `/api/fifa.world/summary…` → `/api/eng.1/summary…`.
- `src/components/RightRail.test.tsx`, `src/components/Ticker.test.ts`, `src/components/TeamPage.test.tsx`: `comp: 'fifa.world'` / `"fifa.world"` → `'eng.1'`.
- `src/pages/sitemap.xml.test.ts`: update expected paths to the `eng.1`/`nba` set.

- [ ] **Step 3: Fix `competitions.test.ts`**

Delete or rewrite the WC-specific cases:
- "builds the World Cup scoreboard URL with the date window and limit" — delete (no comp has `dates` anymore) or rewrite against a synthetic `Competition` literal with `dates` set, to keep `buildUrl`'s dates branch covered. Rewrite (keeps coverage):
  ```ts
  it('includes the date window when a competition sets dates', () => {
    const c = { ...COMPETITIONS['eng.1'], dates: '20260611-20260719' };
    expect(buildUrl(c, 'scoreboard')).toContain('dates=20260611-20260719');
  });
  ```
- "marks the World Cup as scoreboard-sourced top scorers" — delete (WC gone).

- [ ] **Step 4: Typecheck + tests**

Run: `bun run typecheck && bunx vitest run`
Expected: PASS. `grep -rn "fifa\.world" src worker` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(comp): remove the finished 2026 World Cup; default to Premier League

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Comp hub at `/<comp>`, fixtures at `/<comp>/schedule`

`/<comp>` becomes the news hub (news feed + the Layout's cross-comp Ticker as the scores strip + quick links). The fixtures view moves to `/<comp>/schedule`.

**Files:**
- Modify: `src/utils/router.ts` (`Section`: replace `'matches'` and `'news'` with `'home'` + add `'schedule'`; update `SECTION_SUFFIX`, `parseView`)
- Modify: `src/components/CompetitionIsland.tsx` + `src/components/FixturesView.tsx` (drop the now-single-valued `section` prop)
- Create: `src/pages/[comp]/schedule.astro` (moved fixtures page)
- Rewrite: `src/pages/[comp]/index.astro` (news hub)
- Delete: `src/pages/[comp]/news.astro` (hub is the news landing; middleware redirects `/news` in Task 4)
- Modify: `src/components/LeftNav.astro` (Home + Schedule items)
- Modify: `src/pages/sitemap.xml.ts` (`/<comp>` stays, add `/<comp>/schedule`, drop `/<comp>/news`)

**Interfaces:**
- Consumes: `getCompetitionView`, `getCompNews` from `src/data/api.ts` (unchanged signatures).
- Produces: `Section = 'home' | 'schedule' | 'stats' | 'teams' | 'transactions' | 'odds'`. `pathFor({kind:'section',comp,section:'schedule'})` → `/<comp>/schedule`; `section:'home'` → `/<comp>`.

- [ ] **Step 1: Update the router (write the failing test first)**

Add to `src/utils/router.test.ts` (create if absent — check first with `ls src/utils/router.test.ts`):
```ts
import { describe, expect, it } from 'vitest';
import { parseRoute, pathFor } from './router';

describe('router schedule/home', () => {
  it('parses the comp root as the home section', () => {
    expect(parseRoute('/eng.1')).toEqual({ kind: 'section', comp: 'eng.1', section: 'home' });
  });
  it('parses /schedule', () => {
    expect(parseRoute('/eng.1/schedule')).toEqual({
      kind: 'section', comp: 'eng.1', section: 'schedule',
    });
  });
  it('builds the schedule path', () => {
    expect(pathFor({ kind: 'section', comp: 'eng.1', section: 'schedule' })).toBe('/eng.1/schedule');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bunx vitest run src/utils/router.test.ts`
Expected: FAIL (`section: 'home'`/`'schedule'` not produced).

- [ ] **Step 3: Implement router changes**

In `src/utils/router.ts`:
- `Section`: `export type Section = 'home' | 'schedule' | 'stats' | 'teams' | 'transactions' | 'odds';`
- `SECTION_SUFFIX`:
  ```ts
  const SECTION_SUFFIX: Record<Section, string> = {
    home: '',
    schedule: '/schedule',
    stats: '/stats',
    teams: '/teams',
    transactions: '/transactions',
    odds: '/odds',
  };
  ```
- `parseView`: root → `section: 'home'`; add a `seg[0] === 'schedule'` case → `section: 'schedule'`; delete the `'news'` case; the fallback stays `section: 'home'`.
- Update the header comment block (route scheme) to the new URLs and drop the live-stream line.

- [ ] **Step 4: Run router test — expect PASS**

Run: `bunx vitest run src/utils/router.test.ts`
Expected: PASS.

- [ ] **Step 5: Drop the dead `section` prop from the fixtures island**

`FixturesView.tsx`: remove `section` from props/`interface`; delete the `useRouter`/`effectiveSection` leftovers if present; the component always renders fixtures + standings.
`CompetitionIsland.tsx`: remove `section` from both component signatures and the `<FixturesView>` call.

- [ ] **Step 6: Create `src/pages/[comp]/schedule.astro`**

```astro
---
import { env } from 'cloudflare:workers';
import { COMPETITIONS } from '../../competitions';
import CompetitionIsland from '../../components/CompetitionIsland';
import LeftNav from '../../components/LeftNav.astro';
import RightRailIsland from '../../components/RightRailIsland';
import { getCompetitionView } from '../../data/api';
import Layout from '../../layouts/Layout.astro';

const { comp } = Astro.params;
if (!comp || !Object.hasOwn(COMPETITIONS, comp)) {
  return new Response('Not found', { status: 404 });
}
const competition = COMPETITIONS[comp]!;
const ctx = Astro.locals.cfContext;
const initialData = await getCompetitionView(competition, env, ctx);
---
<Layout title={`umuo — ${competition.label} Schedule`} comp={comp}>
  <LeftNav slot="left" comp={comp} active="schedule" />
  <main>
    <CompetitionIsland comp={comp} initialData={initialData} client:only="react" />
  </main>
  <RightRailIsland slot="right" comp={comp} initialData={initialData} client:only="react" />
</Layout>
```

- [ ] **Step 7: Rewrite `src/pages/[comp]/index.astro` as the hub**

```astro
---
import { env } from 'cloudflare:workers';
import { COMPETITIONS } from '../../competitions';
import LeftNav from '../../components/LeftNav.astro';
import NewsIsland from '../../components/NewsIsland';
import NewsRightRailIsland from '../../components/NewsRightRailIsland';
import { getCompNews } from '../../data/api';
import Layout from '../../layouts/Layout.astro';

const { comp } = Astro.params;
if (!comp || !Object.hasOwn(COMPETITIONS, comp)) {
  return new Response('Not found', { status: 404 });
}
const competition = COMPETITIONS[comp]!;
const ctx = Astro.locals.cfContext;
const items = await getCompNews(competition, env, ctx);
---
<Layout title={`umuo — ${competition.label}`} comp={comp}>
  <LeftNav slot="left" comp={comp} active="home" />
  <main>
    <NewsIsland comp={comp} initialData={items} client:only="react" />
  </main>
  <NewsRightRailIsland slot="right" comp={comp} initialNews={items} client:only="react" />
</Layout>
```

- [ ] **Step 8: Delete the old news page**

```bash
git rm src/pages/\[comp\]/news.astro
```

- [ ] **Step 9: Update `LeftNav.astro` items**

Replace the News + Matches items with:
```ts
const items: { section: Section; label: string; href: string }[] = [
  { section: 'home', label: 'News', href: `/${comp}` },
  { section: 'schedule', label: 'Schedule', href: `/${comp}/schedule` },
  { section: 'teams', label: 'Teams', href: `/${comp}/teams` },
  ...(caps?.scorers
    ? [{ section: 'stats' as Section, label: 'Stats', href: `/${comp}/stats` }]
    : []),
  ...(caps?.transactions
    ? [{ section: 'transactions' as Section, label: 'Moves', href: `/${comp}/transactions` }]
    : []),
  ...(caps?.odds ? [{ section: 'odds' as Section, label: 'Odds', href: `/${comp}/odds` }] : []),
];
```

- [ ] **Step 10: Update the sitemap**

In `src/pages/sitemap.xml.ts`, the per-comp block:
```ts
paths.push(`/${c.key}`);
paths.push(`/${c.key}/schedule`);
paths.push(`/${c.key}/teams`);
if (c.capabilities.scorers) paths.push(`/${c.key}/stats`);
if (c.capabilities.transactions) paths.push(`/${c.key}/transactions`);
if (c.capabilities.odds) paths.push(`/${c.key}/odds`);
```
(drops the `/news` line — it now redirects). Update `sitemap.xml.test.ts` expectations to match.

- [ ] **Step 11: Update any page passing `active="matches"` / `section="matches"`**

`grep -rn "active=\"matches\"\|section=\"matches\"\|active=\"news\"" src/pages src/components` — the only remaining callers are the two pages rewritten above; confirm none are left.

- [ ] **Step 12: Typecheck + tests + build**

Run: `bun run typecheck && bunx vitest run && bun run build`
Expected: PASS (build confirms the new `.astro` routes compile).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(routing): comp root is the news hub; fixtures move to /<comp>/schedule

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Middleware redirects

**Files:**
- Modify: `src/middleware.ts`
- Modify: `src/middleware.test.ts`

**Interfaces:**
- Consumes: `COMPETITIONS`, `DEFAULT_COMPETITION` (now `eng.1`).
- Produces: `/` passes through (home renders); `/fifa.world`, `/fifa.world/*`, `/<comp>/bracket`, `/<comp>/news` → 307 to their new homes.

- [ ] **Step 1: Write failing middleware tests**

Add to `src/middleware.test.ts` (follow the existing `run()` helper pattern in that file):
```ts
it('passes the root through to the home page', () => {
  expect(run(`${O}/`).next).toHaveBeenCalled();
});
it('redirects a removed World Cup path to the home', () => {
  expect(run(`${O}/fifa.world/schedule`).redirect).toHaveBeenCalledWith('/', 307);
});
it('redirects a comp news path to its hub', () => {
  expect(run(`${O}/eng.1/news`).redirect).toHaveBeenCalledWith('/eng.1', 307);
});
it('redirects a removed bracket path to the comp hub', () => {
  expect(run(`${O}/eng.1/bracket`).redirect).toHaveBeenCalledWith('/eng.1', 307);
});
```
(Match the exact assertion style already in the file — e.g. whether it asserts on `.next` or a passthrough sentinel. Read the top of the file first.)

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run src/middleware.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement redirects in `src/middleware.ts`**

Add these rules (place the specific ones before the generic comp-prefix passthrough, and the removed-comp rule before the legacy-unprefixed fallback):

- Add an explicit root passthrough right after the existing asset/api guard at the top:
  ```ts
  if (path === '/') return next();
  ```
- Before the "Known competition prefixes pass through" loop, add the retired-World-Cup redirect:
  ```ts
  // World Cup retired (2026-07) — its paths 307 to the home.
  if (path === '/fifa.world' || path.startsWith('/fifa.world/'))
    return context.redirect('/' + search, 307);
  ```

- Inside the known-comp handling, before passing `/${comp}/*` through, add news + bracket collapse:
  ```ts
  if (Object.hasOwn(COMPETITIONS, comp)) {
    if (path === `/${comp}/news` || path === `/${comp}/bracket`)
      return context.redirect(`/${comp}${search}`, 307);
  }
  ```
  (`comp` is already computed as `path.slice(1, slash)` in the existing `/scorers` block — reuse it, or recompute.)

- Delete the old root rule (it's replaced by the top-of-function passthrough above):
  ```ts
  if (path === '/') {
    return context.redirect(`/${DEFAULT_COMPETITION}/news${search}`, 307);
  }
  ```

- Legacy `/news` block: keep, but re-point to the default comp hub: `return context.redirect(`/${DEFAULT_COMPETITION}${search}`, 307);`

- [ ] **Step 4: Run — expect PASS**

Run: `bunx vitest run src/middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(routing): redirect retired World Cup, bracket, and /news paths

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Global home at `/`

Cross-comp news feed (new SSR helper) + the existing cross-comp `Ticker` scores strip + per-comp entry cards.

**Files:**
- Modify: `src/data/api.ts` (add `getAggregatedNews`)
- Test: `src/data/api.test.ts` (create if absent; check `ls src/data/api.test.ts`)
- Create: `src/pages/index.astro`
- Create: `src/components/HomeView.tsx` (island: merged news list + per-comp cards)

**Interfaces:**
- Consumes: `getCompNews(comp, env, ctx): Promise<NewsItem[]>`, `COMPETITIONS`.
- Produces: `getAggregatedNews(env, ctx): Promise<NewsItem[]>` — every comp's news merged, sorted by `published` desc, deduped by `id`.

- [ ] **Step 1: Write the failing test for `getAggregatedNews`**

In `src/data/api.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';

describe('getAggregatedNews', () => {
  it('merges comps and sorts by published desc', async () => {
    const api = await import('./api');
    const spy = vi.spyOn(api, 'getCompNews');
    spy.mockResolvedValueOnce([{ id: 'a', headline: 'A', description: '', published: '2026-07-01T00:00:00Z', byline: '', imageUrl: '', link: '', tags: [] }]);
    spy.mockResolvedValueOnce([{ id: 'b', headline: 'B', description: '', published: '2026-07-05T00:00:00Z', byline: '', imageUrl: '', link: '', tags: [] }]);
    const out = await api.getAggregatedNews({} as never, {} as never);
    expect(out.map((n) => n.id)).toEqual(['b', 'a']);
    spy.mockRestore();
  });
});
```
> Note: if `getCompNews` can't be spied because callers use the local binding, instead inject via a small internal seam — implement `getAggregatedNews` to call the module-local `getCompNews` and test it against a mocked `serve`/`fetch` the way the other api tests do. Read `src/data/api.test.ts` (or nearby test setup) first and mirror that mocking style; do not invent a new one.

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run src/data/api.test.ts`
Expected: FAIL (`getAggregatedNews` not exported).

- [ ] **Step 3: Implement `getAggregatedNews`**

Append to `src/data/api.ts` (near `getCompNews`):
```ts
// Cross-competition news for the global home: fan out getCompNews over every
// registered competition, merge, dedupe by id, newest first. Each comp already
// fails soft (empty array), so one comp's outage never sinks the home feed.
export async function getAggregatedNews(
  env: Env,
  ctx: ExecutionContext,
): Promise<NewsItem[]> {
  const lists = await Promise.all(
    Object.values(COMPETITIONS).map((c) => getCompNews(c, env, ctx)),
  );
  const seen = new Set<string>();
  const merged: NewsItem[] = [];
  for (const item of lists.flat()) {
    if (item.id && seen.has(item.id)) continue;
    if (item.id) seen.add(item.id);
    merged.push(item);
  }
  merged.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''));
  return merged;
}
```
Confirm `COMPETITIONS` and `NewsItem` are already imported in `api.ts`; add imports if not.

- [ ] **Step 4: Run — expect PASS**

Run: `bunx vitest run src/data/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/components/HomeView.tsx`**

Reuse the existing news card styling from `NewsView`/`NewsIsland` — open `src/components/NewsView.tsx` and lift its list-item markup rather than inventing new visuals. Minimal island:
```tsx
import type { NewsItem } from '../types';
import { COMPETITIONS } from '../competitions';
import AppProviders from './AppProviders';

function HomeInner({ news }: { news: NewsItem[] }) {
  return (
    <div className="space-y-section">
      <nav aria-label="Competitions" className="flex gap-2">
        {Object.values(COMPETITIONS).map((c) => (
          <a
            key={c.key}
            href={`/${c.key}`}
            className="rounded-card bg-overlay/5 px-4 py-2 font-display text-sm text-chalk hover:bg-overlay/10 ds-press"
          >
            {c.label}
          </a>
        ))}
      </nav>
      <ul className="space-y-stack">
        {news.map((n) => (
          <li key={n.id}>
            <a href={n.link} target="_blank" rel="noopener" className="block ds-glass rounded-card p-card hover:brightness-105 ds-press">
              <h3 className="font-display text-chalk">{n.headline}</h3>
              {n.description && <p className="ds-caption text-chalkdim mt-1">{n.description}</p>}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HomeView({ news }: { news: NewsItem[] }) {
  return (
    <AppProviders>
      <HomeInner news={news} />
    </AppProviders>
  );
}
```
> Match `NewsView`'s actual card classes/tokens once you read it; the above is the structure, not the final styling.

- [ ] **Step 6: Create `src/pages/index.astro`**

```astro
---
import { env } from 'cloudflare:workers';
import HomeView from '../components/HomeView';
import Layout from '../layouts/Layout.astro';
import { getAggregatedNews } from '../data/api';

const ctx = Astro.locals.cfContext;
const news = await getAggregatedNews(env, ctx);
---
<Layout title="umuo — Sports news, scores & standings">
  <main>
    <HomeView news={news} client:only="react" />
  </main>
</Layout>
```
(No `comp` prop → Header renders comp-agnostic; the Layout's `<Ticker>` already fans out across all comps for the scores strip.)

- [ ] **Step 7: Typecheck + tests + build**

Run: `bun run typecheck && bunx vitest run && bun run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(home): global home at / with aggregated cross-comp news

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Docs + final verification

**Files:**
- Modify: `CLAUDE.md` (routing section, competition list, remove bracket/World Cup/stream mentions)
- Modify: `src/pages/[comp]/match/[slug].astro` (drop the stale "live stream" comment if not already gone)

- [ ] **Step 1: Update `CLAUDE.md`**

- Competitions: `2026 FIFA World Cup, English Premier League, NBA` → `English Premier League, NBA`.
- Routing section: replace the file-based routes list and the `router.ts` route scheme with the new URLs (`/` home, `/<comp>` hub, `/<comp>/schedule`, no `/bracket`, no per-comp `/news`).
- Remove the "live-stream playback" feature bullet and the ppv.st stream paragraph (module already deleted).
- Remove bracket references (the `useBracket`/bracket-capability lines).

- [ ] **Step 2: Drop the stale stream comment**

In `src/pages/[comp]/match/[slug].astro`, the comment "The island owns the full match detail (back, stream, live scoreboard, tabs)" → remove "stream, ".

- [ ] **Step 3: Full verification**

Run: `bun run typecheck && bunx vitest run && bun run lint && bun run build`
Expected: all PASS. `grep -rn "fifa\.world\|bracket\|useStreams\|ppv" src worker CLAUDE.md` returns only intentional matches (none expected).

- [ ] **Step 4: Manual smoke (dev server)**

Run: `bun run dev`, then check: `/` renders home + ticker; `/eng.1` shows news hub; `/eng.1/schedule` shows fixtures; `/eng.1/news` 307s to `/eng.1`; `/fifa.world` 307s to `/`; `/eng.1/bracket` 307s to `/eng.1`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: update CLAUDE.md for content-platform routing; drop stream/WC/bracket

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** WC+bracket removal (T1–T2), `/<comp>` hub + `/schedule` (T3), redirects incl. `/fifa.world/*`→`/`, `/news`→hub, `/bracket`→hub (T4), global `/` home + aggregated news, reusing cross-comp Ticker for scores (T5), docs (T6). Standings-stays-folded and no-sport-nesting non-goals respected. ✓
- **Ticker reuse:** confirmed `useTicker` already fans out over all `COMPETITIONS` — the home scores strip needs no new data code. ✓
- **Order:** bracket before registry (no dangling refs); router `Section` change is split — `'bracket'` removed in T1, `'home'`/`'schedule'` added in T3 — each task stays green. ✓
- **Open risk:** the exact middleware `run()` assertion style and the `api.test.ts` mocking style must be read from those files before writing the new tests (flagged inline in T4/T5).
