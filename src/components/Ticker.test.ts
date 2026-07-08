import { describe, expect, it } from 'vitest';
import { selectTickerMatches } from './Ticker';
import type { Match } from '../types';

const m = (over: Partial<Match>): Match => ({
  id: 0,
  name: 'A vs B',
  category_name: 'football',
  iframe: '',
  viewers: '0',
  substreams: [],
  slug: 'a-vs-b',
  ...over,
});

describe('selectTickerMatches', () => {
  const now = 1_000;

  it('puts live (in-window / alwaysLive) before upcoming, upcoming sorted by kickoff', () => {
    const items = selectTickerMatches(
      [
        m({ id: 1, startsAt: 2_000 }), // future → soon
        m({ id: 2, startsAt: 900, endsAt: 1_100 }), // now inside window → live
        m({ id: 3, alwaysLive: true }), // live
        m({ id: 4, startsAt: 1_500 }), // future → soon (earlier than #1)
      ],
      now,
    );
    expect(items.map((i) => i.id)).toEqual([2, 3, 4, 1]);
    expect(items.filter((i) => i.live).map((i) => i.id)).toEqual([2, 3]);
  });

  it('drops finished streams (past endsAt) and caps upcoming at 10', () => {
    const finished = m({ id: 99, startsAt: 100, endsAt: 500 });
    const future = Array.from({ length: 12 }, (_v, i) => m({ id: i + 1, startsAt: 2_000 + i }));
    const items = selectTickerMatches([finished, ...future], now);
    expect(items.some((i) => i.id === 99)).toBe(false);
    expect(items.length).toBe(10);
  });
});
