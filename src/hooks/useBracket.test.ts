import { describe, expect, it } from 'vitest';
import type { CompMatch, WCGroup } from '../types';
import { assignThirds, winnerOf } from './useBracket';

const LETTERS = 'ABCDEFGHIJKL'.split('');

// Group whose 3rd-placed team (standings[2]) has id `t<L>3`.
function groupWithThird(letter: string): WCGroup {
  const row = (pos: number) => ({
    teamId: `t${letter}${pos}`,
    name: `${letter}${pos}`,
    flag: '',
    mp: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
  });
  return { name: letter, standings: [row(1), row(2), row(3)] };
}

const ALL_GROUPS: WCGroup[] = LETTERS.map(groupWithThird);

function match(o: Partial<CompMatch>): CompMatch {
  return {
    id: '1',
    homeName: 'H',
    awayName: 'A',
    homeFlag: '',
    awayFlag: '',
    homeId: 'h',
    awayId: 'a',
    homeScore: null,
    awayScore: null,
    group: '',
    kickoff: null,
    status: 'finished',
    stage: 'r16',
    homeScorers: [],
    awayScorers: [],
    venue: '',
    slug: 'h-vs-a',
    ...o,
  };
}

describe('winnerOf', () => {
  it('picks the side with the higher score', () => {
    expect(winnerOf(match({ homeScore: 2, awayScore: 1 }))).toBe('home');
    expect(winnerOf(match({ homeScore: 0, awayScore: 3 }))).toBe('away');
  });

  it('prefers ESPN’s winner flag on a level score (penalty shootout)', () => {
    expect(winnerOf(match({ homeScore: 1, awayScore: 1, winner: 'home' }))).toBe('home');
    expect(winnerOf(match({ homeScore: 1, awayScore: 1, winner: 'away' }))).toBe('away');
  });

  it('returns null for a level score with no recorded winner (never defaults to away)', () => {
    expect(winnerOf(match({ homeScore: 1, awayScore: 1 }))).toBeNull();
  });

  it('returns null when the match is unfinished or scores are missing', () => {
    expect(winnerOf(match({ status: 'live', homeScore: 1, awayScore: 0 }))).toBeNull();
    expect(winnerOf(match({ status: 'finished', homeScore: null, awayScore: null }))).toBeNull();
  });
});

describe('assignThirds', () => {
  it('assigns each qualifying third-place group to exactly one slot (no duplicates)', () => {
    // A FIFA-satisfiable set of 8 qualifying thirds. Third-team ids are `t<L>3`.
    const best = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'H', 'I'].map((l) => `t${l}3`));
    const ids = [...assignThirds(ALL_GROUPS, best).values()].map((t) => t.teamId);
    expect(ids).toHaveLength(8); // all 8 third-place slots filled
    expect(new Set(ids).size).toBe(8); // …each by a distinct team — no team appears twice
  });
});
