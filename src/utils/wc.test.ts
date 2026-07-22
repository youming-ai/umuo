import { describe, expect, it } from 'vitest';
import type { WCStanding } from '../types';
import {
  matchSlug,
  parseScore,
  progressFromStatus,
  sortStandings,
  statusFromState,
} from './wc';

describe('parseScore', () => {
  it('parses numeric strings and numbers', () => {
    expect(parseScore('2')).toBe(2);
    expect(parseScore('0')).toBe(0);
    expect(parseScore(3)).toBe(3);
  });
  it('returns null for empty / null / non-numeric', () => {
    expect(parseScore('')).toBeNull();
    expect(parseScore('  ')).toBeNull();
    expect(parseScore('abc')).toBeNull();
    expect(parseScore(undefined)).toBeNull();
    expect(parseScore(null)).toBeNull();
  });
});

describe('statusFromState', () => {
  it('maps ESPN state to MatchStatus', () => {
    expect(statusFromState('post')).toBe('finished');
    expect(statusFromState('in')).toBe('live');
    expect(statusFromState('halftime')).toBe('live');
    expect(statusFromState('pre')).toBe('upcoming');
    expect(statusFromState(undefined)).toBe('upcoming');
  });
});

describe('progressFromStatus', () => {
  it('returns undefined for pre-game state', () => {
    expect(
      progressFromStatus({
        clock: 0,
        displayClock: "0'",
        type: { state: 'pre', period: 0 },
      }),
    ).toBeUndefined();
    expect(progressFromStatus(null)).toBeUndefined();
    expect(progressFromStatus(undefined)).toBeUndefined();
  });

  it('returns post status with FT clock for completed games', () => {
    const p = progressFromStatus({
      clock: 95,
      displayClock: "90'+5'",
      type: { state: 'post', period: 2 },
    });
    expect(p).toEqual({ status: 'post', clock: 95, displayClock: "90'+5'", period: 2 });
  });

  it('falls back to FT when displayClock is empty for post state', () => {
    const p = progressFromStatus({
      clock: 0,
      displayClock: '',
      type: { state: 'post', period: 2 },
    });
    expect(p?.status).toBe('post');
    expect(p?.displayClock).toBe('FT');
  });

  it('returns in status with the current minute for live games', () => {
    const p = progressFromStatus({
      clock: 67.5,
      displayClock: "67'",
      type: { state: 'in', period: 2 },
    });
    expect(p).toEqual({ status: 'in', clock: 67.5, displayClock: "67'", period: 2 });
  });

  it('treats `in` + `displayClock: HT` as half-time (ESPN sometimes uses this shape)', () => {
    const p = progressFromStatus({
      clock: 45,
      displayClock: 'HT',
      type: { state: 'in', period: 1 },
    });
    expect(p?.status).toBe('halftime');
    expect(p?.period).toBe(1);
  });

  it('treats explicit `state: halftime` as half-time', () => {
    const p = progressFromStatus({
      clock: 45,
      displayClock: 'HT',
      type: { state: 'halftime', period: 1 },
    });
    expect(p?.status).toBe('halftime');
    expect(p?.displayClock).toBe('HT');
  });

  it('preserves stoppage-time notation like 45+2', () => {
    const p = progressFromStatus({
      clock: 47,
      displayClock: "45'+2'",
      type: { state: 'in', period: 1 },
    });
    expect(p?.displayClock).toBe("45'+2'");
    expect(p?.clock).toBe(47);
  });

  it('reads period from top-level status.period when type.period is absent', () => {
    const p = progressFromStatus({
      clock: 30,
      displayClock: "30'",
      type: { state: 'in' },
      period: 2,
    });
    expect(p?.period).toBe(2);
  });

  it('falls back to a derived displayClock when ESPN omits it (in + clock > 0)', () => {
    const p = progressFromStatus({
      clock: 23,
      displayClock: '',
      type: { state: 'in', period: 1 },
    });
    expect(p?.displayClock).toBe("23'");
  });

  it('defaults period to 1 for live games with no period info', () => {
    const p = progressFromStatus({
      clock: 10,
      displayClock: "10'",
      type: { state: 'in' },
    });
    expect(p?.period).toBe(1);
  });
});

describe('matchSlug', () => {
  it('builds a readable slug from team names plus the event id', () => {
    expect(matchSlug('Argentina', 'France', '401547')).toBe('argentina-vs-france-401547');
  });

  it('disambiguates repeat fixtures by event id', () => {
    // Same teams meeting twice (group + knockout) must get distinct slugs so
    // the /match route resolves to the right event, not the first match.
    expect(matchSlug('Brazil', 'Spain', '1')).not.toBe(matchSlug('Brazil', 'Spain', '2'));
  });

  it('omits the trailing dash when the event id is missing', () => {
    expect(matchSlug('Mexico', 'Canada', '')).toBe('mexico-vs-canada');
  });
});

describe('sortStandings', () => {
  it('sorts by pts, then gd, then gf (desc) without mutating input', () => {
    const input: WCStanding[] = [
      { teamId: '1', name: 'A', flag: '', mp: 2, w: 1, d: 1, l: 0, gf: 4, ga: 0, gd: 4, pts: 4 },
      { teamId: '2', name: 'B', flag: '', mp: 2, w: 0, d: 2, l: 0, gf: 3, ga: 3, gd: 0, pts: 2 },
      { teamId: '3', name: 'C', flag: '', mp: 2, w: 0, d: 2, l: 0, gf: 2, ga: 2, gd: 0, pts: 2 },
    ];
    const out = sortStandings(input);
    expect(out.map((t) => t.teamId)).toEqual(['1', '2', '3']);
    expect(input[0].teamId).toBe('1'); // original untouched
  });
});
