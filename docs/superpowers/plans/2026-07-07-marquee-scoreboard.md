# Marquee Scoreboard (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A top-of-page scoreboard bar that scrolls the current competition's focus matches (live first, then today, topped up with the nearest upcoming), each chip deep-linking into the match detail page.

**Architecture:** A pure `marqueeMatches(matches, now)` selects + orders the bar's matches from the `CompMatch[]` the App already fetches via `useCompetition` — no new data source. `MarqueeScoreboard` renders a horizontally auto-scrolling strip of compact chips (CSS marquee, hover-pauses, disabled under reduced-motion where it degrades to a manual-scroll strip). App mounts it under the Header on section pages only.

**Tech Stack:** React 18, TypeScript, Tailwind (design tokens), custom History-API router, Vitest + Testing Library.

## Global Constraints

- Biome: 2-space indent, single quotes, semicolons, trailing commas, line width 100. Run `npm run lint` AND `npm run format:check` before every commit (lint alone misses >100-char lines).
- Colors only through tokens (`night`/`panel`/`panel2`/`line`/`chalk`/`chalkdim`/`pitch`/`live`/`amber`); `bg-white/5`-style overlays are the accepted elevation idiom. No hardcoded hex/rgba.
- Reuse existing status i18n keys (`status.live`, `status.ft`); do NOT add new i18n keys.
- Accessibility floor: the auto-scroll animation MUST be disabled under `@media (prefers-reduced-motion: reduce)` (there's a precedent at `src/index.css:187`), leaving a still, manually-scrollable strip.
- Both tsconfigs type-check: `npm run typecheck`. Tests colocated, vitest, jsdom.
- `marqueeMatches` is pure — `now` is injected (no `Date.now()` inside), so it's deterministically testable.

## Out of scope (documented, not built)
- Smart news-linking cards (news → match/player stats): infeasible — `event` categories carry no game id and news entity ids are cross-system (see Phase-2 findings). Not in this plan.
- In-app article reader: feasible (`story` field has HTML) but a separate feature; not this plan.

---

### Task 1: `marqueeMatches` selection helper

**Files:**
- Create: `src/utils/marquee.ts`
- Test: `src/utils/marquee.test.ts`

**Interfaces:**
- Consumes: `CompMatch` from `../types`.
- Produces: `marqueeMatches(matches: CompMatch[], now: number, cap?: number): CompMatch[]`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/marquee.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CompMatch } from '../types';
import { marqueeMatches } from './marquee';

// 2026-06-16T12:00:00Z as "now"
const NOW = Date.parse('2026-06-16T12:00:00Z');
const at = (iso: string) => new Date(iso);

function m(id: string, status: CompMatch['status'], kickoff: Date | null): CompMatch {
  return {
    id,
    homeName: `H${id}`,
    awayName: `A${id}`,
    homeFlag: '',
    awayFlag: '',
    homeId: `h${id}`,
    awayId: `a${id}`,
    homeScore: status === 'upcoming' ? null : 1,
    awayScore: status === 'upcoming' ? null : 0,
    kickoff,
    status,
    homeScorers: [],
    awayScorers: [],
    venue: '',
    slug: `slug-${id}`,
  };
}

describe('marqueeMatches', () => {
  it('orders live first, then today by kickoff, then nearest future', () => {
    const matches = [
      m('future', 'upcoming', at('2026-06-20T15:00:00Z')),
      m('todayLate', 'upcoming', at('2026-06-16T20:00:00Z')),
      m('live', 'live', at('2026-06-16T11:00:00Z')),
      m('todayEarly', 'finished', at('2026-06-16T09:00:00Z')),
    ];
    const ids = marqueeMatches(matches, NOW).map((x) => x.id);
    expect(ids).toEqual(['live', 'todayEarly', 'todayLate', 'future']);
  });

  it('excludes past matches from other days and past upcoming', () => {
    const matches = [
      m('oldFinished', 'finished', at('2026-06-10T15:00:00Z')),
      m('live', 'live', at('2026-06-16T11:00:00Z')),
    ];
    expect(marqueeMatches(matches, NOW).map((x) => x.id)).toEqual(['live']);
  });

  it('tops up with future upcoming when today is thin, and caps the count', () => {
    const matches = Array.from({ length: 20 }, (_, i) =>
      m(`f${i}`, 'upcoming', at(`2026-06-${18 + (i % 10)}T15:00:00Z`)),
    );
    expect(marqueeMatches(matches, NOW, 5)).toHaveLength(5);
  });

  it('returns empty when there is nothing live, today, or upcoming', () => {
    const matches = [m('old', 'finished', at('2026-06-10T15:00:00Z'))];
    expect(marqueeMatches(matches, NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/marquee.test.ts`
Expected: FAIL — `Failed to resolve import "./marquee"`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/marquee.ts`:

```ts
import type { CompMatch } from '../types';

// The scoreboard-bar selection: live matches first (by kickoff), then the rest
// of today's matches (by kickoff), then the nearest upcoming beyond today to
// top up a thin day — capped so the bar stays a glanceable strip. `now` is
// injected so the selection is deterministically testable.
export function marqueeMatches(matches: CompMatch[], now: number, cap = 15): CompMatch[] {
  const today = new Date(now);
  const sameDay = (d: Date | null): boolean =>
    !!d &&
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const ts = (m: CompMatch): number => (m.kickoff ? m.kickoff.getTime() : 0);

  const live = matches.filter((x) => x.status === 'live').sort((a, b) => ts(a) - ts(b));
  const today_ = matches
    .filter((x) => x.status !== 'live' && sameDay(x.kickoff))
    .sort((a, b) => ts(a) - ts(b));
  const future = matches
    .filter((x) => x.status === 'upcoming' && !sameDay(x.kickoff) && ts(x) > now)
    .sort((a, b) => ts(a) - ts(b));

  const seen = new Set<string>();
  const out: CompMatch[] = [];
  for (const x of [...live, ...today_, ...future]) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
    if (out.length >= cap) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/marquee.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + lint + format + commit**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: all clean.

```bash
git add src/utils/marquee.ts src/utils/marquee.test.ts
git commit -m "feat(marquee): scoreboard-bar match selection helper"
```

---

### Task 2: `MarqueeScoreboard` component + marquee CSS

**Files:**
- Modify: `src/index.css` (add `@keyframes marquee-scroll` + a `.marquee-track` rule + its reduced-motion override, next to the existing `live-pulse` block ~line 171-190)
- Create: `src/components/MarqueeScoreboard.tsx`
- Test: `src/components/MarqueeScoreboard.test.tsx`

**Interfaces:**
- Consumes (Task 1): `marqueeMatches`. Also `CompMatch` (types), `navigate`/`pathFor` (router), `useT` (i18n).
- Produces: `export default function MarqueeScoreboard({ matches, comp }: { matches: CompMatch[]; comp: string })`.

- [ ] **Step 1: Add the marquee CSS**

In `src/index.css`, after the existing `@keyframes live-pulse { … }` block (around line 175-185), add:

```css
@keyframes marquee-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

.marquee-track {
  animation: marquee-scroll 45s linear infinite;
}
.marquee-track:hover {
  animation-play-state: paused;
}
```

Then INSIDE the existing `@media (prefers-reduced-motion: reduce) { … }` block (the one at ~line 187 that sets `animation: none`), add a rule disabling the marquee animation:

```css
  .marquee-track {
    animation: none;
  }
```

(The track lives inside an `overflow-x-auto` parent — see the component — so with the animation off it degrades to a still, manually-scrollable strip.)

- [ ] **Step 2: Write the failing test**

Create `src/components/MarqueeScoreboard.test.tsx`:

```ts
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { CompMatch } from '../types';
import MarqueeScoreboard from './MarqueeScoreboard';

function m(id: string, status: CompMatch['status'], kickoff: Date | null): CompMatch {
  return {
    id,
    homeName: 'Mexico',
    awayName: 'Brazil',
    homeFlag: 'mex.png',
    awayFlag: 'bra.png',
    homeId: `h${id}`,
    awayId: `a${id}`,
    homeScore: status === 'upcoming' ? null : 2,
    awayScore: status === 'upcoming' ? null : 1,
    kickoff,
    status,
    homeScorers: [],
    awayScorers: [],
    venue: '',
    slug: `mexico-vs-brazil-${id}`,
  };
}

function renderBar(matches: CompMatch[]) {
  return render(
    <LanguageProvider>
      <MarqueeScoreboard matches={matches} comp="fifa.world" />
    </LanguageProvider>,
  );
}

describe('MarqueeScoreboard', () => {
  it('renders nothing when there are no bar-worthy matches', () => {
    const { container } = renderBar([m('old', 'finished', new Date('2020-01-01T00:00:00Z'))]);
    expect(container.firstChild).toBeNull();
  });

  it('renders a live match chip and navigates to its detail on click', () => {
    const spy = vi.spyOn(window.history, 'pushState');
    // kickoff = now-ish so it counts as today/live
    renderBar([m('L', 'live', new Date())]);
    // Two team crests render (chips duplicate the track for seamless scroll,
    // so query all and assert at least one)
    expect(screen.getAllByAltText('Mexico').length).toBeGreaterThan(0);
    const chip = screen.getAllByRole('button', { name: /Mexico.*Brazil/ })[0];
    fireEvent.click(chip);
    expect(spy).toHaveBeenCalledWith(null, '', '/fifa.world/match/mexico-vs-brazil-L');
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/components/MarqueeScoreboard.test.tsx`
Expected: FAIL — cannot resolve `./MarqueeScoreboard`.

- [ ] **Step 4: Write the component**

Create `src/components/MarqueeScoreboard.tsx`:

```tsx
import { useT } from '../i18n';
import type { CompMatch } from '../types';
import { marqueeMatches } from '../utils/marquee';
import { navigate, pathFor } from '../utils/router';

export default function MarqueeScoreboard({
  matches,
  comp,
}: {
  matches: CompMatch[];
  comp: string;
}) {
  const items = marqueeMatches(matches, Date.now());
  if (items.length === 0) return null;

  // Duplicate the row so the CSS translateX(-50%) loop is seamless. The track
  // auto-scrolls (paused on hover, disabled under reduced-motion via index.css)
  // inside an overflow-x-auto rail that stays manually scrollable regardless.
  const row = [...items, ...items];

  return (
    <div className="border-b border-line/20 bg-night overflow-x-auto no-scrollbar">
      <div className="marquee-track flex w-max gap-2 px-page-x md:px-page-x-md py-2">
        {row.map((match, i) => (
          <Chip key={`${match.id}-${i}`} match={match} comp={comp} />
        ))}
      </div>
    </div>
  );
}

function Chip({ match, comp }: { match: CompMatch; comp: string }) {
  const t = useT();
  const onClick = () => navigate(pathFor({ kind: 'match', comp, slug: match.slug }));
  const time =
    match.kickoff?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '';
  const statusLabel =
    match.status === 'live'
      ? t('status.live')
      : match.status === 'finished'
        ? t('status.ft')
        : time;
  const statusCls =
    match.status === 'live' ? 'text-live' : match.status === 'finished' ? 'text-pitch' : 'text-chalkdim';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${match.homeName} v ${match.awayName}`}
      className="shrink-0 w-40 rounded-card border border-line bg-panel px-2 py-1 text-left transition-colors hover:border-pitch focus:outline-none focus-visible:ring-2 focus-visible:ring-pitch"
    >
      <div className={`ds-caption mb-0.5 ${statusCls}`}>{statusLabel}</div>
      <TeamLine flag={match.homeFlag} name={match.homeName} score={match.homeScore} />
      <TeamLine flag={match.awayFlag} name={match.awayName} score={match.awayScore} />
    </button>
  );
}

function TeamLine({
  flag,
  name,
  score,
}: {
  flag: string;
  name: string;
  score: number | null;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {flag ? (
        <img src={flag} alt={name} className="w-5 h-3.5 object-cover rounded-micro shrink-0" />
      ) : (
        <span className="w-5 h-3.5 shrink-0" />
      )}
      <span className="flex-1 min-w-0 truncate font-display text-[11px] text-chalk">{name}</span>
      {score != null && (
        <span className="ml-1 text-[11px] tabular-nums text-chalk shrink-0">{score}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/MarqueeScoreboard.test.tsx`
Expected: PASS (2 tests). The click test relies on the chip's accessible name being `"Mexico v Brazil"` (from `aria-label`) — the crest `alt` also contains "Mexico", so the test queries by `role: 'button'`.

- [ ] **Step 6: Typecheck + lint + format + commit**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: all clean.

```bash
git add src/index.css src/components/MarqueeScoreboard.tsx src/components/MarqueeScoreboard.test.tsx
git commit -m "feat(marquee): auto-scrolling scoreboard bar component"
```

---

### Task 3: Mount the bar in App (section pages)

**Files:**
- Modify: `src/App.tsx` (import + render `MarqueeScoreboard` under the Header on section routes)

**Interfaces:**
- Consumes (Task 2): `MarqueeScoreboard`. App already has `wc.matches` (from `useCompetition(route.comp)`) and `route.comp`.

- [ ] **Step 1: Add the import**

In `src/App.tsx`, with the other component imports at the top:

```ts
import MarqueeScoreboard from './components/MarqueeScoreboard';
```

- [ ] **Step 2: Render the bar under the Header on section pages**

In `src/App.tsx`'s returned JSX, the structure is:
```tsx
    <div className="flex flex-col h-dvh overflow-y-auto …">
      <Header section={route.kind === 'section' ? route.section : undefined} />
      <div className="flex-1 flex flex-col">{content}</div>
      …
```
Insert the bar between `<Header …/>` and the content `<div>`. Render it only on section routes (where a competition and its matches are in context — news pages are competition-agnostic, match/team/player pages are focused views). `MarqueeScoreboard` returns `null` on its own when there are no bar-worthy matches (e.g. while loading or off-season), so no extra guard is needed:

```tsx
      <Header section={route.kind === 'section' ? route.section : undefined} />
      {route.kind === 'section' && <MarqueeScoreboard matches={wc.matches} comp={route.comp} />}
      <div className="flex-1 flex flex-col">{content}</div>
```

- [ ] **Step 3: Verify the whole feature**

Run: `npm run typecheck && npm run lint && npm run format:check && npx vitest run`
Expected: typecheck clean, lint/format clean, full suite green.

Then manually smoke it:
```bash
npm run dev
# in another shell (use the printed port, default 5173):
```
- Open `http://localhost:5173/fifa.world` → a scoreboard bar sits under the header showing live/today/upcoming matches; it auto-scrolls and pauses on hover.
- Click a chip → navigates to `/fifa.world/match/<slug>` (the detail page).
- Open `http://localhost:5173/news` → NO bar (news is competition-agnostic).
- If your OS has "reduce motion" on, the bar is static but still scrollable by drag/wheel.
Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(marquee): mount scoreboard bar under the header on section pages"
```

---

## Self-Review

**1. Spec coverage (PRD §3.1 Scoreboard Bar):**
- Top-of-page scoreboard bar → Task 3 mounts it under the Header ✓
- Scrolls the day's focus matches → Task 1 selection (live → today → nearest upcoming) + Task 2 auto-scroll ✓
- Click a match → into the detail/"battle report" page → Task 2 `Chip` navigates to the match route ✓
- (PRD §3.1's "各大项" cross-sport bar is intentionally scoped to the CURRENT competition here: the App already has that comp's matches with zero extra fetches; a cross-comp bar would need to fan out to 3 scoreboards. Documented as a deliberate simplification — extend later if cross-sport is wanted.)
- Deferred/out-of-scope (documented above): smart news-linking cards (infeasible), in-app reader (separate feature).

**2. Placeholder scan:** No TBD/TODO/"handle edge cases". Every step has real code + exact commands. `marqueeMatches` and both components carry complete implementations.

**3. Type consistency:** `marqueeMatches(matches, now, cap?)` defined in Task 1, called in Task 2's component with `Date.now()`. `MarqueeScoreboard({ matches, comp })` defined in Task 2, mounted with `wc.matches`/`route.comp` in Task 3. `Chip` navigates via `pathFor({ kind: 'match', comp, slug })` — matches the router's existing `match` route kind. No new i18n keys (reuses `status.live`/`status.ft`).
