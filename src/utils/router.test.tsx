import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPath, navigate, parseRoute, pathFor, useRouter } from './router';

const MATCHES = { kind: 'section', comp: 'fifa.world', section: 'matches' } as const;

describe('parseRoute', () => {
  it('maps / and empty path to the matches section', () => {
    expect(parseRoute('/')).toEqual(MATCHES);
    expect(parseRoute('')).toEqual(MATCHES);
    expect(parseRoute('/?foo=bar')).toEqual(MATCHES);
  });

  it('parses the section routes', () => {
    expect(parseRoute('/scorers')).toEqual({
      kind: 'section',
      comp: 'fifa.world',
      section: 'scorers',
    });
    expect(parseRoute('/bracket')).toEqual({
      kind: 'section',
      comp: 'fifa.world',
      section: 'bracket',
    });
  });

  it('treats the removed /standings route as unknown → matches section', () => {
    expect(parseRoute('/standings')).toEqual(MATCHES);
  });

  it('treats removed /live routes as unknown → matches section', () => {
    expect(parseRoute('/live')).toEqual(MATCHES);
    expect(parseRoute('/live/echo-1')).toEqual(MATCHES);
  });

  it('strips a trailing slash', () => {
    expect(parseRoute('/match/foo/')).toEqual({ kind: 'match', comp: 'fifa.world', slug: 'foo' });
  });

  it('parses /match/<slug>', () => {
    expect(parseRoute('/match/foo')).toEqual({ kind: 'match', comp: 'fifa.world', slug: 'foo' });
    expect(parseRoute('/match/foo?tab=stats')).toEqual({
      kind: 'match',
      comp: 'fifa.world',
      slug: 'foo',
    });
  });

  it('parses /team/<id> and /player/<id>', () => {
    expect(parseRoute('/team/464')).toEqual({ kind: 'team', comp: 'fifa.world', teamId: '464' });
    expect(parseRoute('/player/12345')).toEqual({
      kind: 'player',
      comp: 'fifa.world',
      athleteId: '12345',
    });
  });

  it('decodes URI-encoded slugs', () => {
    expect(parseRoute('/match/argentina-vs-france')).toEqual({
      kind: 'match',
      comp: 'fifa.world',
      slug: 'argentina-vs-france',
    });
  });

  it('falls back to the matches section for unknown paths', () => {
    expect(parseRoute('/something/random')).toEqual(MATCHES);
  });

  it('falls back to matches on malformed percent-encoding instead of throwing', () => {
    // decodeURIComponent throws URIError on these; parseRoute must not.
    expect(() => parseRoute('/match/%')).not.toThrow();
    expect(parseRoute('/match/%')).toEqual(MATCHES);
    expect(parseRoute('/team/%E0%A4%A')).toEqual(MATCHES);
    expect(parseRoute('/live/%C3%28')).toEqual(MATCHES);
  });

  it('parses a competition-prefixed path', () => {
    expect(parseRoute('/fifa.world')).toEqual(MATCHES);
    expect(parseRoute('/fifa.world/scorers')).toEqual({
      kind: 'section',
      comp: 'fifa.world',
      section: 'scorers',
    });
    expect(parseRoute('/fifa.world/bracket')).toEqual({
      kind: 'section',
      comp: 'fifa.world',
      section: 'bracket',
    });
    expect(parseRoute('/fifa.world/match/foo')).toEqual({
      kind: 'match',
      comp: 'fifa.world',
      slug: 'foo',
    });
    expect(parseRoute('/fifa.world/team/464')).toEqual({
      kind: 'team',
      comp: 'fifa.world',
      teamId: '464',
    });
  });

  it('treats an unknown first segment as a legacy path under the default competition', () => {
    // 'xyz' is not in COMPETITIONS → whole path parsed under default comp
    expect(parseRoute('/xyz/scorers')).toEqual(MATCHES);
  });

  it('does not let an inherited Object.prototype name spoof a known competition', () => {
    // A bare truthy index (COMPETITIONS[seg[0]]) would resolve these to
    // Object.prototype members and wrongly treat them as a known competition.
    expect(parseRoute('/constructor/scorers')).toEqual(MATCHES);
    expect(parseRoute('/toString')).toEqual(MATCHES);
  });
});

describe('pathFor', () => {
  it('round-trips parseRoute → pathFor → parseRoute', () => {
    const cases: Array<ReturnType<typeof parseRoute>> = [
      { kind: 'section', comp: 'fifa.world', section: 'matches' },
      { kind: 'section', comp: 'fifa.world', section: 'scorers' },
      { kind: 'section', comp: 'fifa.world', section: 'bracket' },
      { kind: 'match', comp: 'fifa.world', slug: 'argentina-vs-france' },
      { kind: 'team', comp: 'fifa.world', teamId: '464' },
      { kind: 'player', comp: 'fifa.world', athleteId: '12345' },
    ];
    for (const r of cases) {
      expect(parseRoute(pathFor(r))).toEqual(r);
    }
  });

  it('prefixes the competition and URI-encodes special characters in slugs', () => {
    expect(pathFor({ kind: 'section', comp: 'fifa.world', section: 'matches' })).toBe(
      '/fifa.world',
    );
    expect(pathFor({ kind: 'match', comp: 'fifa.world', slug: 'foo bar' })).toBe(
      '/fifa.world/match/foo%20bar',
    );
    expect(pathFor({ kind: 'team', comp: 'fifa.world', teamId: 'a/b' })).toBe(
      '/fifa.world/team/a%2Fb',
    );
  });
});

describe('canonicalPath', () => {
  it('returns the prefixed path for a legacy (unprefixed) URL', () => {
    expect(canonicalPath('/scorers')).toBe('/fifa.world/scorers');
    expect(canonicalPath('/match/foo')).toBe('/fifa.world/match/foo');
    expect(canonicalPath('/')).toBe('/fifa.world');
  });

  it('returns null when the path is already canonical', () => {
    expect(canonicalPath('/fifa.world')).toBeNull();
    expect(canonicalPath('/fifa.world/scorers')).toBeNull();
    expect(canonicalPath('/fifa.world/match/foo')).toBeNull();
  });
});

describe('navigate', () => {
  let original: { push: typeof history.pushState; replace: typeof history.replaceState };

  beforeEach(() => {
    original = { push: window.history.pushState, replace: window.history.replaceState };
    window.history.pushState = vi.fn() as unknown as typeof window.history.pushState;
    window.history.replaceState = vi.fn() as unknown as typeof window.history.replaceState;
    // reset to a known pathname.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    window.history.pushState = original.push;
    window.history.replaceState = original.replace;
  });

  it('uses pushState by default', () => {
    navigate('/match/abc');
    expect(window.history.pushState).toHaveBeenCalled();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });

  it('uses replaceState when { replace: true }', () => {
    navigate('/match/abc', { replace: true });
    expect(window.history.replaceState).toHaveBeenCalled();
    expect(window.history.pushState).not.toHaveBeenCalled();
  });

  it('is a no-op when navigating to the current path', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/match/abc' },
      writable: true,
      configurable: true,
    });
    navigate('/match/abc');
    expect(window.history.pushState).not.toHaveBeenCalled();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });

  it('dispatches a route-change event so useRouter can sync', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    navigate('/match/abc');
    expect(spy.mock.calls.some(([e]) => (e as Event).type === 'app:routechange')).toBe(true);
    spy.mockRestore();
  });
});

describe('news routes', () => {
  it('parses the news scopes from the path', () => {
    expect(parseRoute('/news')).toEqual({ kind: 'news', scope: { by: 'all' } });
    expect(parseRoute('/news/soccer')).toEqual({
      kind: 'news',
      scope: { by: 'sport', sport: 'soccer' },
    });
    expect(parseRoute('/news/league/nba')).toEqual({
      kind: 'news',
      scope: { by: 'league', league: 'nba' },
    });
    expect(parseRoute('/news/team/lal')).toEqual({
      kind: 'news',
      scope: { by: 'team', team: 'lal' },
    });
  });

  it('round-trips scope → path → scope', () => {
    for (const scope of [
      { by: 'all' } as const,
      { by: 'sport', sport: 'basketball' } as const,
      { by: 'league', league: 'eng.1' } as const,
      { by: 'team', team: 'che' } as const,
    ]) {
      expect(parseRoute(pathFor({ kind: 'news', scope }))).toEqual({ kind: 'news', scope });
    }
  });

  it('falls back to the all scope for an unknown news shape', () => {
    expect(parseRoute('/news/league')).toEqual({ kind: 'news', scope: { by: 'all' } });
  });
});

describe('useRouter', () => {
  function Harness({ onReady }: { onReady: (r: ReturnType<typeof useRouter>) => void }) {
    onReady(useRouter());
    return null;
  }

  it('returns the parsed route on mount', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/match/foo' },
      writable: true,
      configurable: true,
    });
    let captured!: ReturnType<typeof useRouter>;
    render(<Harness onReady={(route) => (captured = route)} />);
    expect(captured.route).toEqual({ kind: 'match', comp: 'fifa.world', slug: 'foo' });
  });

  it('reacts to popstate events', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/' },
      writable: true,
      configurable: true,
    });
    let captured!: ReturnType<typeof useRouter>;
    render(<Harness onReady={(route) => (captured = route)} />);
    expect(captured.route).toEqual(MATCHES);

    // Simulate back navigation to /match/foo.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/match/foo' },
      writable: true,
      configurable: true,
    });
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(captured.route).toEqual({ kind: 'match', comp: 'fifa.world', slug: 'foo' });
  });

  it('reacts to route-change events from a programmatic navigate()', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/' },
      writable: true,
      configurable: true,
    });
    let captured!: ReturnType<typeof useRouter>;
    render(<Harness onReady={(route) => (captured = route)} />);
    expect(captured.route).toEqual(MATCHES);

    // A direct navigate() (as FixturesView does) updates history and
    // fires the route-change event; useRouter must re-parse off it.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/match/foo' },
      writable: true,
      configurable: true,
    });
    act(() => {
      window.dispatchEvent(new Event('app:routechange'));
    });

    expect(captured.route).toEqual({ kind: 'match', comp: 'fifa.world', slug: 'foo' });
  });

  it('exposes a go() that updates the route immediately', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/' },
      writable: true,
      configurable: true,
    });
    let captured!: ReturnType<typeof useRouter>;
    render(<Harness onReady={(route) => (captured = route)} />);
    expect(captured.route).toEqual(MATCHES);

    act(() => {
      captured.go('/match/abc');
    });
    expect(captured.route).toEqual({ kind: 'match', comp: 'fifa.world', slug: 'abc' });
  });
});
