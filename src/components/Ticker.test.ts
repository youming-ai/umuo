import { describe, expect, it } from 'vitest';
import type { CompMatch } from '../types';
import { formatTickerLine } from './Ticker';
import type { TickerMatch } from '../hooks/useTicker';

function m(over: Partial<CompMatch> & { comp?: string }): TickerMatch {
  return {
    id: '1',
    homeName: 'Mexico',
    awayName: 'South Africa',
    homeFlag: '',
    awayFlag: '',
    homeId: 'h1',
    awayId: 'a1',
    homeScore: 2,
    awayScore: 0,
    kickoff: new Date('2026-06-13T19:00Z'),
    status: 'live',
    homeScorers: [],
    awayScorers: [],
    venue: '',
    slug: 'mexico-vs-south-africa',
    comp: 'fifa.world',
    ...over,
  };
}

describe('formatTickerLine', () => {
  it('shows score, teams, and clock for a live match', () => {
    const line = formatTickerLine(
      m({
        status: 'live',
        homeScore: 1,
        awayScore: 0,
        progress: { status: 'in', clock: 67, displayClock: "67'", period: 2 },
      }),
    );
    expect(line).toBe("1-0 Mexico – South Africa 67'");
  });

  it('shows score and teams for a finished match', () => {
    const line = formatTickerLine(m({ status: 'finished', homeScore: 2, awayScore: 1 }));
    expect(line).toBe('2-1 Mexico – South Africa');
  });

  it('shows kickoff time and teams for an upcoming match', () => {
    const kickoff = new Date('2026-06-13T19:00Z');
    const line = formatTickerLine(m({ status: 'upcoming', homeScore: null, awayScore: null, kickoff }));
    expect(line).toMatch(/Mexico – South Africa/);
    expect(line).toMatch(/\d{2}:\d{2}/);
  });
});