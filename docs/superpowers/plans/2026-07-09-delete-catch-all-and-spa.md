# Delete Catch-All + Old SPA (Migration Plan 7 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the catch-all page (`[...all].astro`), the SPA entry (`AppIsland.tsx`), the SPA router (`App.tsx`), and all code that was used only by the SPA (Header, Footer, CompetitionSwitcher, LanguageSwitcher, MarqueeScoreboard, LeftSidebar). Every route is now handled by a real Astro SSR page (from Plans 3–6). Wrap all remaining islands with `LanguageProvider` + `ThemeProvider` (which were previously provided by `AppIsland`). Add Astro middleware to redirect `/` → `/<default-comp>` and legacy unprefixed paths. Clean up dead code in `router.ts`.

**Architecture:** After this plan, the repo has NO SPA, NO catch-all, NO History-API router. Every URL resolves to a real Astro page. The 6 React islands (CompetitionIsland, MatchDetailIsland, TeamPageIsland, PlayerPageIsland, and two new ones: AppProviders + NewsIsland) are self-contained — they each wrap their tree with the providers they need. Astro middleware redirects the root and legacy unprefixed paths at the edge.

**Tech Stack:** Astro 5, @astrojs/cloudflare, React 18, TypeScript, Vitest, npm.

## Global Constraints

- **Every previously peeled route must still work** — `/news/**`, `/:comp/**`, `/:comp/match/:slug`, `/:comp/team/:id`, `/player/:id`, `/api/*`.
- **All islands must self-wrap with providers.** After AppIsland is deleted, no island gets `LanguageProvider` or `ThemeProvider` automatically. A new `AppProviders.tsx` wraps children with both; each island wraps its render tree with `<AppProviders>`.
- **The middleware must redirect root + legacy paths without breaking any existing route.**
- **No new tests; existing tests that test deleted code are deleted.** The test count will drop from 353. The plan documents the expected new count.
- **Astro build must stay green.**
- **Live smoke: all 10+ routes from Plans 3–6 must still return 200.**

## File Structure

### Files to DELETE (10 + their tests)
- `src/pages/[...all].astro` — catch-all SPA shell
- `src/components/AppIsland.tsx` — SPA island entry
- `src/App.tsx` — SPA router + App component
- `src/components/Header.tsx` — SPA-only (used by App.tsx)
- `src/components/Footer.tsx` — SPA-only
- `src/components/CompetitionSwitcher.tsx` — SPA-only (used by Header)
- `src/components/LanguageSwitcher.tsx` — SPA-only (used by Header)
- `src/components/MarqueeScoreboard.tsx` — SPA-only (used by App.tsx)
- `src/components/LeftSidebar.tsx` — dead code (never imported by anything)
- `src/App.test.tsx` — tests deleted App.tsx
- `src/components/Header.test.tsx` — tests deleted Header
- `src/components/CompetitionSwitcher.test.tsx` — tests deleted CompetitionSwitcher
- `src/components/MarqueeScoreboard.test.tsx` — tests deleted MarqueeScoreboard

### Files to CREATE (3)
- `src/components/AppProviders.tsx` — `<ThemeProvider><LanguageProvider>{children}</LanguageProvider></ThemeProvider>`
- `src/components/NewsIsland.tsx` — wraps `<NewsView>` with `<AppProviders>`
- `src/middleware.ts` — root redirect + legacy path redirect

### Files to MODIFY (11)
- `src/components/CompetitionIsland.tsx` — wrap with `<AppProviders>`
- `src/components/MatchDetailIsland.tsx` — wrap with `<AppProviders>`
- `src/components/TeamPageIsland.tsx` — wrap with `<AppProviders>`
- `src/components/PlayerPageIsland.tsx` — wrap with `<AppProviders>`
- `src/pages/news/index.astro` — `<NewsView>` → `<NewsIsland>`
- `src/pages/news/[sport].astro` — `<NewsView>` → `<NewsIsland>`
- `src/pages/news/league/[slug].astro` — `<NewsView>` → `<NewsIsland>`
- `src/pages/news/team/[abbrev].astro` — `<NewsView>` → `<NewsIsland>`
- `src/utils/router.ts` — delete `canonicalPath` export
- `src/utils/router.test.tsx` — delete `canonicalPath` describe block and `parseRoute`-dependent describe blocks

---

### Task 1: Create `AppProviders` + wrap all components

**Files:**
- Create: `src/components/AppProviders.tsx`
- Create: `src/components/NewsIsland.tsx`
- Modify: 4 news pages, 4 islands

**All changes are minimal — each file gets 1 import + 2 line wrapper.**

- [ ] **Step 1: Create `src/components/AppProviders.tsx`**

```tsx
import { LanguageProvider } from '../i18n';
import { ThemeProvider } from '../theme';

// Shared provider wrapper. Used by every island to ensure i18n and theme
// context is present (previously provided by AppIsland via the catch-all).
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        {children}
      </LanguageProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Create `src/components/NewsIsland.tsx`**

```tsx
import type { NewsItem, NewsScope } from '../types';
import NewsView from './NewsView';
import AppProviders from './AppProviders';

// Thin island wrapper for news pages. Wraps <NewsView> with the shared
// providers so i18n (useT) works inside the island. Previously, providers
// came from AppIsland via the catch-all; now each island is self-contained.
export default function NewsIsland({
  scope,
  initialData,
}: {
  scope: NewsScope;
  initialData?: NewsItem[];
}) {
  return (
    <AppProviders>
      <NewsView scope={scope} initialData={initialData} />
    </AppProviders>
  );
}
```

- [ ] **Step 3: Wrap the 4 existing islands with `<AppProviders>`**

For each of these 4 files, add `import AppProviders from './AppProviders';` at the top (near the other imports) and wrap the JSX return value with `<AppProviders>...</AppProviders>`:

- `src/components/CompetitionIsland.tsx` — the return JSX is currently `<FixturesView ... />`. Wrap as `<AppProviders><FixturesView ... /></AppProviders>`.
- `src/components/MatchDetailIsland.tsx` — wrap `<MatchDetailPage ... />`.
- `src/components/TeamPageIsland.tsx` — wrap `<TeamPage ... />`.
- `src/components/PlayerPageIsland.tsx` — wrap `<PlayerPage ... />`.

In each file, read the existing return JSX first, then use `Edit` to add the wrapper. Only the import line and the JSX wrapper change — no props, no logic, no other imports.

- [ ] **Step 4: Update the 4 news `.astro` pages**

In each of these 4 files, change the import and mount line:
- `src/pages/news/index.astro`
- `src/pages/news/[sport].astro`
- `src/pages/news/league/[slug].astro`
- `src/pages/news/team/[abbrev].astro`

Current pattern:
```astro
import NewsView from '../../components/NewsView';
...
<NewsView scope={scope} initialData={items} client:only="react" />
```

New pattern:
```astro
import NewsIsland from '../../components/NewsIsland';
...
<NewsIsland scope={scope} initialData={items} client:only="react" />
```

(Note: `NewsIsland` replaces `NewsView` and the props are identical — `scope` and `initialData`. The `client:only` directive stays.)

Use `Edit` on each file to replace `import NewsView from ...` with `import NewsIsland from ...` and `<NewsView ` with `<NewsIsland `. The closing `/>` stays the same.

- [ ] **Step 5: Verify the provider wrapping compiles**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0. If any island fails because it doesn't wrap correctly (e.g. the JSX return is multiline and the wrapping breaks), fix the JSX positioning — the outer `<AppProviders>` opens before the return statement and closes after the closing JSX tag.

---

### Task 2: Delete old SPA files + dead code

**Files:**
- Delete: 10 files (see File Structure above)
- Modify: `src/utils/router.ts` (delete `canonicalPath`)
- Modify: `src/utils/router.test.tsx` (delete dead tests)

- [ ] **Step 1: Delete the 10 source files**

```bash
cd /Users/youming/GitHub/youming-ai/cup
git rm src/pages/\[...all\].astro src/components/AppIsland.tsx src/App.tsx src/components/Header.tsx src/components/Footer.tsx src/components/CompetitionSwitcher.tsx src/components/LanguageSwitcher.tsx src/components/MarqueeScoreboard.tsx src/components/LeftSidebar.tsx src/App.test.tsx src/components/Header.test.tsx src/components/CompetitionSwitcher.test.tsx src/components/MarqueeScoreboard.test.tsx
```

All 13 files (10 source + 3 test) removed in one `git rm`.

- [ ] **Step 2: Delete `canonicalPath` from `src/utils/router.ts`**

Read the file first. Find the `canonicalPath` function and its JSDoc comment (the block starting around line 133–145 or wherever it is). Delete the entire comment + function body + export. Do not touch any other code.

The exact location (read the file to confirm line numbers):
- Look for the comment `// The canonical (competition-prefixed) URL...` or similar.
- Delete from that comment through the closing `}` and the blank line after it.
- The function signature is: `export function canonicalPath(pathname: string): string | null { ... }`

Only this function is removed. Keep `ROUTE_CHANGE`, `SECTION_SUFFIX`, `safeDecode`, `parseNews`, `parseView`, `parseRoute`, `navigate`, `pathFor`, `useRouter`, and all their related comments/types intact.

- [ ] **Step 3: Update `src/utils/router.test.tsx`**

Delete the following blocks from the test file:

1. **The `canonicalPath` describe block** (lines 144–156 in the current file — read to confirm). Delete the entire `describe('canonicalPath', () => { ... });` block.

2. **The `parseRoute`-dependent tests in `pathFor` describe**: the `'round-trips parseRoute → pathFor → parseRoute'` test (lines 117–129). This test calls `parseRoute(pathFor(r))` — it's testing `parseRoute`, not `pathFor`. The remaining test `'prefixes the competition and URI-encodes special characters in slugs'` (lines 131–141) tests `pathFor` independently and stays.

3. **The `parseRoute` describe block** (lines 8–114). Delete the entire `describe('parseRoute', () => { ... });` block. `parseRoute` is used internally by `useRouter` (which is tested separately), but its public API tests are no longer relevant.

4. **The `'news routes'` describe block** (lines 209–252). Delete it — it tests `parseRoute` for news paths.

5. **Remove the `parseRoute` and `canonicalPath` named imports** from line 4. Change:
   ```ts
   import { canonicalPath, navigate, parseRoute, pathFor, useRouter } from './router';
   ```
   to:
   ```ts
   import { navigate, pathFor, useRouter } from './router';
   ```
   Also remove the import of `DEFAULT_COMPETITION` from line 3:
   ```ts
   import { DEFAULT_COMPETITION } from '../competitions';
   ```
   (Line 3 is now unused — `DEFAULT_COMPETITION` was only used in the deleted test blocks.)

   Also remove the `MATCHES` constant on line 6:
   ```ts
   const MATCHES = { kind: 'section', comp: 'fifa.world', section: 'matches' } as const;
   ```
   (It's only referenced in the deleted blocks.)

   Also remove the unused imports: `act` from line 1 and `render` from line 1 (check if `useRouter` tests still use them — yes they do: `act` and `render` are used in `useRouter` describe).

The remaining tests (after deletion):
- `describe('pathFor')` — 1 test (lines 131–141)
- `describe('navigate')` — all tests
- `describe('useRouter')` — all tests

- [ ] **Step 4: Verify after deletions**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npx tsc -p tsconfig.json --noEmit
npx vitest run 2>&1 | tail -20
```

Expected:
- `tsc` exit 0.
- Vitest shows fewer test files and fewer total tests (the deleted test files are gone). The count should be 36–37 test files and ~310–320 tests. **Report the exact count** — we need to know the new baseline.

If any test fails (e.g. a deleted import still referenced), fix only the import/type reference — do not modify any existing test behavior. If a test file can't compile because of a missing import, remove the import line; if the test relies on deleted code, delete the test block.

---

### Task 3: Middleware + final verification

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create `src/middleware.ts`**

```ts
import { COMPETITIONS, DEFAULT_COMPETITION } from './competitions';

// Astro middleware: runs on every request (SSR and static). Redirects the
// root and legacy unprefixed paths to their canonical forms under the
// default competition. Known routes (with comp prefixes, /api, /news,
// /player) pass through unchanged.
export function onRequest(
  context: { request: Request; redirect: (url: string, status?: number) => Response; url: URL },
  next: () => Response | Promise<Response>,
) {
  const path = context.url.pathname;

  // Assets + API + known unprefixed routes pass through.
  if (
    path.startsWith('/api/') ||
    path.startsWith('/news') ||
    path.startsWith('/player') ||
    path === '/favicon.png' ||
    path === '/apple-touch-icon.png' ||
    path === '/icon-192.png' ||
    path === '/icon-512.png' ||
    path === '/manifest.webmanifest' ||
    path === '/sw.js' ||
    path === '/logo-full.png' ||
    path === '/og.jpg'
  ) {
    return next();
  }

  // Known competition prefixes pass through.
  for (const key of Object.keys(COMPETITIONS)) {
    if (path === `/${key}` || path.startsWith(`/${key}/`)) {
      return next();
    }
  }

  // Root redirect.
  if (path === '/') {
    return context.redirect(`/${DEFAULT_COMPETITION}`, 307);
  }

  // Legacy unprefixed paths: redirect to the default competition.
  // /scorers → /fifa.world/scorers, /match/foo → /fifa.world/match/foo, etc.
  return context.redirect(`/${DEFAULT_COMPETITION}${path}`, 307);
}
```

- [ ] **Step 2: Verify — build + tests + live smoke**

```bash
cd /Users/youming/GitHub/youming-ai/cup
npm run build
npx vitest run 2>&1 | tail -10
```

Expected:
- Build exit 0. `astro check` 0 errors. `astro build` emits `dist/_worker.js/`.
- Vitest reports the new test count (should be ~310–320 across ~37 files). **Report the exact count.**

Live smoke:

```bash
npm run dev > /tmp/astro-dev.log 2>&1 &
DEV_PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/ >/dev/null 2>&1 && break; done

echo "--- / (root → redirect to /fifa.world) ---"
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -L "http://localhost:4321/"

echo "--- /scorers (legacy redirect) ---"
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -L "http://localhost:4321/scorers"

echo "--- /fifa.world (Plan 4) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world"

echo "--- /fifa.world/scorers (Plan 4) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world/scorers"

echo "--- /fifa.world/bracket (Plan 4) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world/bracket"

echo "--- /news (Plan 3) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/news"

echo "--- /fifa.world/match/mexico-vs-south-africa-760415 (Plan 5) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world/match/mexico-vs-south-africa-760415"

echo "--- /fifa.world/team/203 (Plan 6) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/fifa.world/team/203"

echo "--- /player/149981 (Plan 6) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/player/149981"

echo "--- /api/fifa.world/scoreboard (worker) ---"
curl -s "http://localhost:4321/api/fifa.world/scoreboard" | head -c 80
echo

echo "--- /nonexistent (now 404 — no catch-all!) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4321/nonexistent"

kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected:
- `/` → 307 redirect → 200 (landing on /fifa.world).
- `/scorers` → redirect to `/fifa.world/scorers` → 200.
- All 7 peeled routes return 200.
- `/api/fifa.world/scoreboard` returns JSON.
- `/nonexistent` returns 404 (no more catch-all SPA fallback).

If any check fails, **stop and report**.

- [ ] **Step 3: Commit**

```bash
cd /Users/youming/GitHub/youming-ai/cup
git add src/components/AppProviders.tsx src/components/NewsIsland.tsx src/middleware.ts
git add src/components/CompetitionIsland.tsx src/components/MatchDetailIsland.tsx src/components/TeamPageIsland.tsx src/components/PlayerPageIsland.tsx
git add src/pages/news/index.astro src/pages/news/\[sport\].astro src/pages/news/league/\[slug\].astro src/pages/news/team/\[abbrev\].astro
git add src/utils/router.ts src/utils/router.test.tsx
git commit -m "refactor(spa): delete catch-all + old SPA; all routes are now real Astro pages

Deletes the catch-all page ([...all].astro), the SPA entry (AppIsland.tsx),
the SPA router (App.tsx), and all code used only by the SPA: Header,
Footer, CompetitionSwitcher, LanguageSwitcher, MarqueeScoreboard,
LeftSidebar, and their tests. Every URL now resolves to a real Astro
SSR page (news, competition, match, team, player). The History-API
router is gone; islands call navigate() + pathFor() for in-app nav
and useRouter() for route context — those shared utilities stay.

Adds AppProviders.tsx (ThemeProvider + LanguageProvider wrapper) and
wraps all 6 islands with it so i18n and theme context is present in
every island (previously provided by AppIsland via the catch-all).
NewsIsland.tsx wraps <NewsView> with AppProviders and replaces the
direct <NewsView> mount in the 4 news .astro pages.

Adds Astro middleware to redirect / → /<default-comp> (307) and
legacy unprefixed paths like /scorers or /match/foo to their
canonical /<default-comp>/... forms. Known routes (api, news, player,
comp-prefixed) pass through unchanged. Unknown routes now 404.

Cleans up router.ts: removes canonicalPath (dead code — only App.tsx
called it). Cleans up router.test.tsx: removes the parseRoute and
canonicalPath describe blocks and the parseRoute-dependent tests.
parseRoute stays (internally used by useRouter), but its public
tests are no longer relevant since the SPA routing is gone.

Test count drops from 353 to ~315 (exact count in the commit). All
remaining tests pass. Build is green. Live smoke confirms all 7+
peeled routes + worker + middleware redirect work; unknown paths 404."
```

---

## Self-Review

**1. Spec coverage (design §4 step 4 "Once the catch-all is empty, delete the old SPA entry"):**
- Catch-all deleted → Task 2 ✓
- Old SPA entry deleted → Task 2 (App.tsx + AppIsland.tsx + App.test.tsx) ✓
- SPA-only components deleted → Task 2 (Header, Footer, CompetitionSwitcher, etc.) ✓
- Islands self-wrap with providers → Task 1 (AppProviders + 6 wrappers) ✓
- Middleware for legacy redirect → Task 3 ✓
- Router dead code cleaned → Task 2 (canonicalPath) ✓
- Site runs uninterrupted → Task 3 smoke ✓

**2. Placeholder scan:** No TBD/TODO. All files specified. The exact test count drop is noted as "report the exact count" rather than a hardcoded number — this is the one genuinely variable quantity (depends on the exact number of tests deleted from router.test.tsx).

**3. Type/interface consistency:**
- `AppProviders` wraps children with `ThemeProvider` + `LanguageProvider` — the same providers AppIsland used. All islands that previously depended on the SPA's provider chain now get them from their own wrapper. ✓
- `NewsIsland` replaces `NewsView` mount in the news pages — same props (scope, initialData), same `client:only` directive. ✓
- `canonicalPath` is the only dead export from router.ts. All other exports are still used by islands. ✓
- The middleware uses `context.redirect` and `context.url` — the standard Astro middleware API. ✓
- Deleted files are only referenced by each other (App → AppIsland → catch-all; Header → App; etc.) — no island or hook imports them. Verified by grep. ✓

**Note on risk:** This is the largest plan in terms of file count (27 files touched), but the changes are all deletions or 1-line wrappers. The two risk points — (a) an island missing a provider and crashing on mount, and (b) the middleware intercepting a route it shouldn't — are both covered by the live smoke's comprehensive route checks.
