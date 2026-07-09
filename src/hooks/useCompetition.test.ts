import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompetition } from './useCompetition';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

function ok(data: unknown) {
  return { ok: true, json: async () => data };
}

// minimal ESPN scoreboard shape: a finished group match + an upcoming knockout match
const scoreboard = {
  events: [
    {
      id: '760420',
      date: '2026-06-13T19:00Z',
      season: { slug: 'group-stage' },
      competitions: [
        {
          status: { type: { state: 'post' } },
          venue: { fullName: "Levi's Stadium", address: { city: 'Santa Clara, California' } },
          competitors: [
            {
              homeAway: 'home',
              score: '2',
              team: { id: '1', displayName: 'Mexico', logo: 'mex.png' },
            },
            {
              homeAway: 'away',
              score: '0',
              team: { id: '2', displayName: 'South Africa', logo: 'rsa.png' },
            },
          ],
          details: [
            {
              scoringPlay: true,
              clock: { displayValue: "22'" },
              type: { text: 'Goal' },
              team: { id: '1' },
              athletesInvolved: [{ id: '4577', displayName: 'H. Lozano' }],
            },
            {
              scoringPlay: true,
              clock: { displayValue: "80'" },
              type: { text: 'Penalty - Scored' },
              team: { id: '1' },
              athletesInvolved: [{ id: '4579', displayName: 'R. Jiménez' }],
            },
            { scoringPlay: false, type: { text: 'Yellow Card' }, team: { id: '2' } },
          ],
        },
      ],
    },
    {
      id: '760900',
      date: '2026-07-04T16:00Z',
      season: { slug: 'round-of-16' },
      competitions: [
        {
          status: { type: { state: 'pre' } },
          venue: { fullName: 'MetLife Stadium', address: { city: 'East Rutherford' } },
          competitors: [
            {
              homeAway: 'home',
              score: '0',
              team: { id: '9', displayName: 'Brazil', logos: [{ href: 'bra.png' }] },
            },
            {
              homeAway: 'away',
              score: '0',
              team: { id: '12', displayName: 'Scotland', logos: [{ href: 'sco.png' }] },
            },
          ],
          details: [],
        },
      ],
    },
  ],
};

const standings = {
  children: [
    {
      name: 'Group A',
      standings: {
        entries: [
          {
            team: { id: '1', displayName: 'Mexico', logos: [{ href: 'mex.png' }] },
            stats: [
              { name: 'gamesPlayed', value: 1 },
              { name: 'wins', value: 1 },
              { name: 'ties', value: 0 },
              { name: 'losses', value: 0 },
              { name: 'pointsFor', value: 2 },
              { name: 'pointsAgainst', value: 0 },
              { name: 'pointDifferential', value: 2 },
              { name: 'points', value: 3 },
            ],
          },
          {
            team: { id: '2', displayName: 'South Africa', logos: [{ href: 'rsa.png' }] },
            stats: [
              { name: 'gamesPlayed', value: 1 },
              { name: 'wins', value: 0 },
              { name: 'ties', value: 0 },
              { name: 'losses', value: 1 },
              { name: 'pointsFor', value: 0 },
              { name: 'pointsAgainst', value: 2 },
              { name: 'pointDifferential', value: -2 },
              { name: 'points', value: 0 },
            ],
          },
        ],
      },
    },
  ],
};

describe('useCompetition', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('normalizes ESPN scoreboard + standings', async () => {
    fetchMock.mockResolvedValueOnce(ok(scoreboard)).mockResolvedValueOnce(ok(standings));

    const { result } = renderHook(() => useCompetition('fifa.world'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.matches).toHaveLength(2);

    const finished = result.current.matches[0];
    expect(finished.status).toBe('finished');
    expect(finished.homeScore).toBe(2);
    expect(finished.homeFlag).toBe('mex.png');
    expect(finished.stage).toBe('group');
    expect(finished.group).toBe('A'); // resolved from standings membership
    expect(finished.homeScorers).toEqual([
      { playerId: '4577', name: 'H. Lozano', minute: "22'", tag: '' },
      { playerId: '4579', name: 'R. Jiménez', minute: "80'", tag: ' (p)' },
    ]);
    expect(finished.awayScorers).toEqual([]);
    expect(finished.venue).toBe("Levi's Stadium · Santa Clara, California");
    expect(finished.kickoff?.toISOString()).toBe('2026-06-13T19:00:00.000Z');

    const upcoming = result.current.matches[1];
    expect(upcoming.status).toBe('upcoming');
    expect(upcoming.homeScore).toBeNull();
    expect(upcoming.stage).toBe('r16');
    expect(upcoming.homeFlag).toBe('bra.png'); // logos[].href fallback

    const sd = result.current.standings;
    expect(sd.kind).toBe('soccer');
    if (sd.kind !== 'soccer') throw new Error('expected soccer');
    const groupA = sd.groups[0];
    expect(groupA.name).toBe('A'); // "Group A" → "A"
    expect(groupA.standings[0].name).toBe('Mexico');
    expect(groupA.standings[0].pts).toBe(3);
    expect(groupA.standings[0].gd).toBe(2);
  });

  it('captures penalty-shootout score and finishType for a pens match', async () => {
    const pens = {
      events: [
        {
          id: '760489',
          date: '2026-07-05T16:00Z',
          season: { slug: 'round-of-16' },
          competitions: [
            {
              status: {
                period: 5,
                displayClock: "120'",
                type: { state: 'post', name: 'STATUS_FINAL_PEN' },
              },
              venue: { fullName: 'X', address: { city: 'Y' } },
              competitors: [
                {
                  homeAway: 'home',
                  score: '1',
                  winner: false,
                  shootoutScore: 3,
                  team: { id: '1', displayName: 'Germany', logo: 'ger.png' },
                },
                {
                  homeAway: 'away',
                  score: '1',
                  winner: true,
                  shootoutScore: 4,
                  team: { id: '2', displayName: 'Paraguay', logo: 'par.png' },
                },
              ],
              details: [],
            },
          ],
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(ok(pens)).mockResolvedValueOnce(ok({}));
    const { result } = renderHook(() => useCompetition('fifa.world'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const m = result.current.matches[0];
    expect(m.finishType).toBe('pens');
    expect(m.homeShootoutScore).toBe(3);
    expect(m.awayShootoutScore).toBe(4);
    expect(m.winner).toBe('away');
  });

  it('marks an extra-time decider as aet with no shootout score', async () => {
    const aet = {
      events: [
        {
          id: '760490',
          date: '2026-07-05T20:00Z',
          season: { slug: 'quarterfinals' },
          competitions: [
            {
              status: {
                period: 4,
                displayClock: "120'",
                type: { state: 'post', name: 'STATUS_FINAL_AET' },
              },
              venue: { fullName: 'X', address: { city: 'Y' } },
              competitors: [
                {
                  homeAway: 'home',
                  score: '2',
                  winner: true,
                  team: { id: '1', displayName: 'Spain', logo: 's.png' },
                },
                {
                  homeAway: 'away',
                  score: '1',
                  winner: false,
                  team: { id: '2', displayName: 'Italy', logo: 'i.png' },
                },
              ],
              details: [],
            },
          ],
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(ok(aet)).mockResolvedValueOnce(ok({}));
    const { result } = renderHook(() => useCompetition('fifa.world'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const m = result.current.matches[0];
    expect(m.finishType).toBe('aet');
    expect(m.homeShootoutScore).toBeUndefined();
    expect(m.awayShootoutScore).toBeUndefined();
  });

  it('sets error when a request fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(ok(standings));
    const { result } = renderHook(() => useCompetition('fifa.world'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load World Cup data');
  });

  it('fails closed on a competition switch: no stale cross-comp data, error not suppressed', async () => {
    // First comp loads successfully.
    fetchMock.mockResolvedValueOnce(ok(scoreboard)).mockResolvedValueOnce(ok(standings));
    const { result, rerender } = renderHook(({ comp }) => useCompetition(comp), {
      initialProps: { comp: 'fifa.world' },
    });
    await waitFor(() => expect(result.current.matches.length).toBeGreaterThan(0));

    // Switch to a different competition whose fetch fails. The stale fifa.world
    // cache must NOT be served, and the new comp's error must NOT be suppressed.
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('nba down'));
    rerender({ comp: 'nba' });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.matches).toEqual([]);
    expect(result.current.scorers).toEqual([]);
    expect(result.current.standings).toEqual({ kind: 'soccer', groups: [] });
  });

  it('sets error when fetch throws (network failure)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network error'));
    const { result } = renderHook(() => useCompetition('fifa.world'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('tolerates missing/empty payloads without throwing', async () => {
    fetchMock.mockResolvedValueOnce(ok({})).mockResolvedValueOnce(ok({}));
    const { result } = renderHook(() => useCompetition('fifa.world'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.matches).toEqual([]);
    expect(result.current.standings).toEqual({ kind: 'soccer', groups: [] });
  });

  it('aborts the in-flight request on refetch', async () => {
    let firstSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options: { signal?: AbortSignal }) => {
      if (!firstSignal) firstSignal = options?.signal;
      return new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          {
            once: true,
          },
        );
      });
    });

    const { result } = renderHook(() => useCompetition('fifa.world'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(firstSignal?.aborted).toBe(false);

    act(() => {
      result.current.refetch();
    });
    expect(firstSignal?.aborted).toBe(true);
  });

  it('aborts the in-flight request on unmount', async () => {
    let firstSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options: { signal?: AbortSignal }) => {
      if (!firstSignal) firstSignal = options?.signal;
      return new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          {
            once: true,
          },
        );
      });
    });

    const { unmount } = renderHook(() => useCompetition('fifa.world'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(firstSignal?.aborted).toBe(false);

    unmount();
    expect(firstSignal?.aborted).toBe(true);
  });

  it('skips the first fetch when initialData is provided and non-empty', async () => {
    const seed = {
      matches: [
        {
          id: 'seed-1',
          homeName: 'A',
          awayName: 'B',
          homeFlag: '',
          awayFlag: '',
          homeId: '1',
          awayId: '2',
          homeScore: 0,
          awayScore: 0,
          kickoff: null,
          status: 'upcoming' as const,
          homeScorers: [],
          awayScorers: [],
          venue: '',
          slug: 'a-vs-b',
        },
      ],
      standings: { kind: 'soccer' as const, groups: [] },
      scorers: [],
    };
    const { result } = renderHook(() => useCompetition('fifa.world', seed));
    // synchronous: the seeded state is visible without waiting for any fetch
    expect(result.current.loading).toBe(false);
    expect(result.current.matches).toEqual(seed.matches);
    expect(result.current.standings).toEqual(seed.standings);
    expect(result.current.scorers).toEqual(seed.scorers);
    expect(result.current.error).toBeNull();
    // wait one tick for any effect to settle; the fetch must NOT have happened
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
