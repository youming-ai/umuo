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

  it('seeds state immediately from initialScores and preserves per-comp tags', () => {
    const seed = [match('1', 'nba'), match('2', 'esp.1')];
    const { result } = renderHook(() => useTicker(seed));
    expect(result.current.loading).toBe(false);
    expect(result.current.items.map((m) => m.comp)).toEqual(['nba', 'esp.1']);
  });

  // Ticker and HomeView are separate hydration roots; mount order is arbitrary.
  // The unseeded one must not stall on empty just because it got there first.
  it('hands the seed to an unseeded island that mounted before the seeder', () => {
    const seed = [match('1', 'nba')];
    const { result: unseeded } = renderHook(() => useTicker());
    expect(unseeded.current.items).toEqual([]);

    renderHook(() => useTicker(seed));

    expect(unseeded.current.items.map((m) => m.comp)).toEqual(['nba']);
    expect(unseeded.current.loading).toBe(false);
  });

  // The mirror hazard: a late seeder must not clobber scores the shared poll
  // already fetched. The render-time guard only seeds while `shared` is empty.
  // A single 200 with zero matches while others fail must not be treated as
  // an authoritative empty board. Otherwise it would erase a late seed and lock
  // hasSuccessfulPoll on a false negative.
  it('does not treat a partial fan-out as a successful empty board', async () => {
    let call = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      call += 1;
      // First league returns an empty OK; all others fail.
      return {
        ok: call === 1,
        status: call === 1 ? 200 : 502,
        json: async () => ({ events: [] }),
      } as Response;
    });

    const { result: live } = renderHook(() => useTicker());
    await waitFor(() => expect(live.current.loading).toBe(false));

    expect(live.current.items).toEqual([]);

    const seed = [match('1', 'nba'), match('2', 'esp.1')];
    renderHook(() => useTicker(seed));

    expect(live.current.items.map((m) => m.comp)).toEqual(['nba', 'esp.1']);
    expect(live.current.loading).toBe(false);
  });

  // The mirror hazard, part 2: if the first poll outright failed (network
  // outage, all upstream 502s), we still want an SSR-seeded HomeView that
  // mounts later to bring useful scores into the shared ticker. The successful
  // poll test above must not make all-empty boards treated as authoritative.
  it('still accepts a late SSR seed after the initial poll fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    } as Response);

    const { result: live, unmount } = renderHook(() => useTicker());
    await waitFor(() => expect(live.current.loading).toBe(false));

    expect(live.current.items).toEqual([]);

    const seed = [match('1', 'nba'), match('2', 'esp.1')];
    renderHook(() => useTicker(seed));

    expect(live.current.items.map((m) => m.comp)).toEqual(['nba', 'esp.1']);
    expect(live.current.loading).toBe(false);

    unmount();
  });

  it('does not overwrite already-fetched scores with a stale seed', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    } as Response);

    const { result: live } = renderHook(() => useTicker());
    await waitFor(() => expect(live.current.loading).toBe(false));

    renderHook(() => useTicker([match('99', 'nba')]));

    // Poll returned an empty board; the seed must not resurrect stale matches.
    expect(live.current.items).toEqual([]);
  });
});
