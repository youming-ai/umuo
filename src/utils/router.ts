import { useCallback, useEffect, useState } from 'react';
import { COMPETITIONS, DEFAULT_COMPETITION } from '../competitions';
import type { NewsScope } from '../types';

// One-route-fits-all router built on the History API. No react-router /
// wouter dep — the surface area is small enough that a single module is
// enough. The Worker serves index.html for unknown paths
// (assets.not_found_handling = single-page-application), so deep links
// resolve to the SPA at page refresh.
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

// pushState/replaceState do NOT emit `popstate`, so `useRouter` can't see a
// programmatic navigation on its own. Every `navigate()` dispatches this event
// and the hook re-parses on it — that's what keeps any caller (FixturesView,
// App) in sync without threading a setter through props.
const ROUTE_CHANGE = 'app:routechange';

// Programmatic navigation. Default behaviour: pushState (back/forward works).
// Pass `{ replace: true }` for state-only updates that shouldn't grow the
// history stack (e.g. tab switches).
export function navigate(path: string, opts: { replace?: boolean; scroll?: boolean } = {}): void {
  const { replace = false, scroll = false } = opts;
  if (window.location.pathname + window.location.search === path) return;
  if (replace) {
    window.history.replaceState(null, '', path);
  } else {
    window.history.pushState(null, '', path);
  }
  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
  window.dispatchEvent(new Event(ROUTE_CHANGE));
}

// React hook: subscribes to popstate (back/forward) + our route-change event
// (programmatic navigate), returns the current Route and a `go` alias.
export function useRouter(): {
  route: Route;
  go: (path: string, opts?: { replace?: boolean; scroll?: boolean }) => void;
} {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const sync = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', sync);
    window.addEventListener(ROUTE_CHANGE, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(ROUTE_CHANGE, sync);
    };
  }, []);

  const go = useCallback((path: string, opts?: { replace?: boolean; scroll?: boolean }) => {
    navigate(path, opts);
    setRoute(parseRoute(path));
  }, []);

  return { route, go };
}
