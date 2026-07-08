import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate, pathFor, useRouter } from './router';

const MATCHES = { kind: 'section', comp: 'fifa.world', section: 'matches' } as const;

describe('pathFor', () => {
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
