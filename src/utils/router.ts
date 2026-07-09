import { COMPETITIONS, DEFAULT_COMPETITION } from '../competitions';
import type { NewsScope } from '../types';

// Every route is a real Astro SSR page (no client router / catch-all SPA
// anymore — see commit 81b71fc). `parseRoute`/`pathFor` are shared purely to
// build/read URLs consistently between server pages and client islands;
// `navigate()` performs a real browser navigation to move between them.
//
// Route scheme (every view is addressable — shareable, back/forward, refresh):
//   /<comp>              matches (schedule; group standings live under the group filter)
//   /<comp>/scorers      top scorers
//   /<comp>/bracket      knockout bracket
//   /<comp>/match/<slug> ESPN fixture detail (hosts the live stream player when one
//                        matches — there is no separate /live page anymore)
//   /<comp>/team/<id>    team page
//   /<comp>/player/<id>  player page
// Unprefixed legacy paths (pre-multi-comp links) resolve under DEFAULT_COMPETITION.

// The schedule sections (group standings are folded into the matches view).
export type Section = 'matches' | 'scorers' | 'bracket';

// Every route carries the competition it belongs to (URL first segment).
export type Route =
  | { kind: 'section'; comp: string; section: Section }
  | { kind: 'match'; comp: string; slug: string }
  | { kind: 'team'; comp: string; teamId: string }
  | { kind: 'player'; comp: string; athleteId: string }
  | { kind: 'news'; comp: string; scope: NewsScope }; // comp is nominal (DEFAULT_COMPETITION); pathFor ignores it for news URLs — present only so route.comp is valid on every kind

// section → path suffix under /<comp> (matches is the competition root).
const SECTION_SUFFIX: Record<Section, string> = {
  matches: '',
  scorers: '/scorers',
  bracket: '/bracket',
};

// decodeURIComponent throws URIError on malformed input (e.g. "/match/%").
// Path segments are untrusted, so decode defensively and treat a bad segment
// as no match → home fallback, never a thrown error that crashes the tree.
function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// News is cross-competition (no comp prefix). Parse the segments AFTER `news`.
function parseNews(seg: string[]): Route {
  if (seg.length === 0) return { kind: 'news', comp: DEFAULT_COMPETITION, scope: { by: 'all' } };
  if (seg[0] === 'league') {
    if (seg[1]) {
      const league = safeDecode(seg[1]);
      if (league)
        return { kind: 'news', comp: DEFAULT_COMPETITION, scope: { by: 'league', league } };
    }
    return { kind: 'news', comp: DEFAULT_COMPETITION, scope: { by: 'all' } };
  }
  if (seg[0] === 'team') {
    if (seg[1]) {
      const team = safeDecode(seg[1]);
      if (team) return { kind: 'news', comp: DEFAULT_COMPETITION, scope: { by: 'team', team } };
    }
    return { kind: 'news', comp: DEFAULT_COMPETITION, scope: { by: 'all' } };
  }
  if (seg.length === 1) {
    const sport = safeDecode(seg[0]!);
    if (sport) return { kind: 'news', comp: DEFAULT_COMPETITION, scope: { by: 'sport', sport } };
  }
  return { kind: 'news', comp: DEFAULT_COMPETITION, scope: { by: 'all' } };
}

// Parse the view segments (everything AFTER the competition prefix) into a
// Route body for the resolved competition. Unknown shapes fall back to the
// matches section, never throw.
function parseView(comp: string, seg: string[]): Route {
  if (seg.length === 0) return { kind: 'section', comp, section: 'matches' };
  if (seg.length === 1 && seg[0] === 'scorers')
    return { kind: 'section', comp, section: 'scorers' };
  if (seg.length === 1 && seg[0] === 'bracket')
    return { kind: 'section', comp, section: 'bracket' };
  if (seg.length === 2 && seg[0] === 'match') {
    const slug = safeDecode(seg[1]!);
    if (slug !== null) return { kind: 'match', comp, slug };
  }
  if (seg.length === 2 && seg[0] === 'team') {
    const teamId = safeDecode(seg[1]!);
    if (teamId !== null) return { kind: 'team', comp, teamId };
  }
  if (seg.length === 2 && seg[0] === 'player') {
    const athleteId = safeDecode(seg[1]!);
    if (athleteId !== null) return { kind: 'player', comp, athleteId };
  }
  return { kind: 'section', comp, section: 'matches' };
}

export function parseRoute(pathname: string): Route {
  // Normalise: strip query and trailing slash, split into non-empty segments.
  const path = pathname.split('?')[0]?.replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);
  if (seg[0] === 'news') return parseNews(seg.slice(1));
  // First segment is the competition when it's a known key; otherwise the
  // whole path is a legacy (pre-multi-comp) link under the default competition.
  if (seg.length > 0 && Object.hasOwn(COMPETITIONS, seg[0]!)) {
    return parseView(seg[0]!, seg.slice(1));
  }
  return parseView(DEFAULT_COMPETITION, seg);
}

export function pathFor(route: Route): string {
  if (route.kind === 'news') {
    const s = route.scope;
    if (s.by === 'sport') return `/news/${encodeURIComponent(s.sport)}`;
    if (s.by === 'league') return `/news/league/${encodeURIComponent(s.league)}`;
    if (s.by === 'team') return `/news/team/${encodeURIComponent(s.team)}`;
    return '/news';
  }
  const prefix = `/${route.comp}`;
  switch (route.kind) {
    case 'section':
      return `${prefix}${SECTION_SUFFIX[route.section]}`;
    case 'match':
      return `${prefix}/match/${encodeURIComponent(route.slug)}`;
    case 'team':
      return `${prefix}/team/${encodeURIComponent(route.teamId)}`;
    case 'player':
      return `${prefix}/player/${encodeURIComponent(route.athleteId)}`;
  }
}

// Real cross-page navigation (every route is its own SSR document — there's
// no client router to intercept a pushState). Default: assign (back/forward
// works, adds a history entry). Pass `{ replace: true }` to swap the current
// entry instead (e.g. a "this deep link doesn't apply here" correction).
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (window.location.pathname + window.location.search === path) return;
  if (opts.replace) {
    window.location.replace(path);
  } else {
    window.location.assign(path);
  }
}

// Reads the route for the current URL. A real navigate() reloads the
// document, so there's nothing to subscribe to — every mount already sees
// the URL it was served for.
export function useRouter(): { route: Route } {
  return { route: parseRoute(window.location.pathname) };
}
