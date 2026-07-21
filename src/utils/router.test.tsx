import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate, parseRoute, pathFor, useRouter } from './router';

describe('pathFor', () => {
  it('prefixes the competition and URI-encodes special characters in slugs', () => {
    expect(pathFor({ kind: 'section', comp: 'eng.1', section: 'home' })).toBe('/eng.1');
    expect(pathFor({ kind: 'match', comp: 'eng.1', slug: 'foo bar' })).toBe(
      '/eng.1/match/foo%20bar',
    );
    expect(pathFor({ kind: 'team', comp: 'eng.1', teamId: 'a/b' })).toBe('/eng.1/team/a%2Fb');
  });
});

describe('navigate', () => {
  const original = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  // jsdom's location.assign/replace aren't individually spy-able — stub the
  // whole object, same trick the original pushState-based tests used.
  function stubLocation(pathname: string) {
    const assign = vi.fn();
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname, assign, replace },
      writable: true,
      configurable: true,
    });
    return { assign, replace };
  }

  it('uses location.assign by default', () => {
    const { assign, replace } = stubLocation('/');
    navigate('/match/abc');
    expect(assign).toHaveBeenCalledWith('/match/abc');
    expect(replace).not.toHaveBeenCalled();
  });

  it('uses location.replace when { replace: true }', () => {
    const { assign, replace } = stubLocation('/');
    navigate('/match/abc', { replace: true });
    expect(replace).toHaveBeenCalledWith('/match/abc');
    expect(assign).not.toHaveBeenCalled();
  });

  it('is a no-op when navigating to the current path', () => {
    const { assign, replace } = stubLocation('/match/abc');
    navigate('/match/abc');
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('useRouter', () => {
  function Harness({ onReady }: { onReady: (r: ReturnType<typeof useRouter>) => void }) {
    onReady(useRouter());
    return null;
  }

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/match/foo' },
      writable: true,
      configurable: true,
    });
  });

  it('returns the parsed route for the current URL', () => {
    let captured!: ReturnType<typeof useRouter>;
    render(<Harness onReady={(route) => (captured = route)} />);
    expect(captured.route).toEqual({ kind: 'match', comp: 'eng.1', slug: 'foo' });
  });
});

describe('parseRoute (hub + schedule)', () => {
  it('parses the comp root as the home section', () => {
    expect(parseRoute('/eng.1')).toEqual({ kind: 'section', comp: 'eng.1', section: 'home' });
  });

  it('parses /schedule', () => {
    expect(parseRoute('/eng.1/schedule')).toEqual({
      kind: 'section',
      comp: 'eng.1',
      section: 'schedule',
    });
  });

  it('builds the schedule path', () => {
    expect(pathFor({ kind: 'section', comp: 'eng.1', section: 'schedule' })).toBe(
      '/eng.1/schedule',
    );
  });
});
