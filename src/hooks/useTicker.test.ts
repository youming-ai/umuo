import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPETITIONS } from '../competitions';
import { __resetTickerForTests, useTicker } from './useTicker';

const emptyBoard = { events: [] };
// The ticker fans out over every registered competition — derive the expected
// call count / URLs from the registry so this stays correct as comps are added.
const COMP_COUNT = Object.keys(COMPETITIONS).length;
const EXPECTED_URLS = Object.keys(COMPETITIONS)
  .map((k) => `/api/${k}/scoreboard`)
  .sort();

describe('useTicker shared poller', () => {
  beforeEach(() => {
    __resetTickerForTests();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => emptyBoard }));
  });

  afterEach(() => {
    __resetTickerForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts loading until the first fetch settles', async () => {
    const { result } = renderHook(() => useTicker());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('shares one fan-out across two hook instances', async () => {
    const { result: a } = renderHook(() => useTicker());
    const { result: b } = renderHook(() => useTicker());

    await waitFor(() => {
      expect(a.current.loading).toBe(false);
      expect(b.current.loading).toBe(false);
    });

    // every competition × 1 shared poll (not one poll per hook instance).
    expect(fetch).toHaveBeenCalledTimes(COMP_COUNT);
    const urls = vi
      .mocked(fetch)
      .mock.calls.map((c) => String(c[0]))
      .sort();
    expect(urls).toEqual(EXPECTED_URLS);
  });

  it('does not start a second poll while the first is still subscribed', async () => {
    const { unmount: unmountA } = renderHook(() => useTicker());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(COMP_COUNT));

    renderHook(() => useTicker());
    // Still only the initial shared fetch — second mount reuses state.
    expect(fetch).toHaveBeenCalledTimes(COMP_COUNT);

    unmountA();
    // Remaining subscriber keeps the poller alive; no extra fan-out.
    expect(fetch).toHaveBeenCalledTimes(COMP_COUNT);
  });
  it('seeds state immediately from initialScores and preserves per-comp tags', () => {
    const match = (id: string, comp: string) => ({
      id,
      comp,
      homeName: 'H',
      awayName: 'A',
      homeFlag: '',
      awayFlag: '',
      homeId: '1',
      awayId: '2',
      homeScore: 1,
      awayScore: 0,
      kickoff: new Date(),
      status: 'live' as const,
      homeScorers: [],
      awayScorers: [],
      venue: '',
      slug: `h-vs-a-${id}`,
    });
    const seed = [match('1', 'nba'), match('2', 'esp.1')];
    const { result } = renderHook(() => useTicker(seed));
    expect(result.current.loading).toBe(false);
    expect(result.current.items.map((m) => m.comp)).toEqual(['nba', 'esp.1']);
  });
});
