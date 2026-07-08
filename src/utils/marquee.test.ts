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
