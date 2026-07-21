import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetTickerForTests, useTicker } from './useTicker';

const emptyBoard = { events: [] };

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

    // 2 competitions × 1 shared poll (not 2 independent polls).
    expect(fetch).toHaveBeenCalledTimes(2);
    const urls = vi
      .mocked(fetch)
      .mock.calls.map((c) => String(c[0]))
      .sort();
    expect(urls).toEqual(['/api/eng.1/scoreboard', '/api/nba/scoreboard']);
  });

  it('does not start a second poll while the first is still subscribed', async () => {
    const { unmount: unmountA } = renderHook(() => useTicker());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    renderHook(() => useTicker());
    // Still only the initial shared fetch — second mount reuses state.
    expect(fetch).toHaveBeenCalledTimes(2);

    unmountA();
    // Remaining subscriber keeps the poller alive; no extra fan-out.
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
