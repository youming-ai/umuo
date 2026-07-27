import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SECTIONS } from '../sections';
import { parseRoute, pathFor, useRouter } from './router';

describe('pathFor', () => {
  it('prefixes the competition and URI-encodes special characters in slugs', () => {
    expect(pathFor({ kind: 'section', comp: 'eng.1', section: 'news' })).toBe('/eng.1');
    expect(pathFor({ kind: 'match', comp: 'eng.1', slug: 'foo bar' })).toBe(
      '/eng.1/match/foo%20bar',
    );
    expect(pathFor({ kind: 'team', comp: 'eng.1', teamId: 'a/b' })).toBe('/eng.1/team/a%2Fb');
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
  it('parses the comp root as the news section', () => {
    expect(parseRoute('/eng.1')).toEqual({ kind: 'section', comp: 'eng.1', section: 'news' });
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

  it('round-trips every section in the SECTIONS table', () => {
    for (const s of SECTIONS) {
      const route = { kind: 'section', comp: 'eng.1', section: s.section } as const;
      expect(parseRoute(pathFor(route))).toEqual(route);
    }
  });
});
