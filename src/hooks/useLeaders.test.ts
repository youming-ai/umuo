import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Leader } from '../types';
import { useLeaders } from './useLeaders';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  // jsdom defaults visibilityState to 'visible'
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sample = [
  {
    rank: 1,
    name: 'Erling Haaland',
    teamName: 'Man City',
    teamLogo: 'mci.png',
    displayValue: '27',
    value: 27,
  },
  {
    rank: 2,
    name: 'Bukayo Saka',
    teamName: 'Arsenal',
    teamLogo: 'ars.png',
    displayValue: '18',
    value: 18,
  },
];

describe('useLeaders', () => {
  it('fetches /api/<comp>/leaders and exposes the Leader[]', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => sample });
    const { result } = renderHook(() => useLeaders('eng.1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/eng.1/leaders', expect.any(Object));
    expect(result.current.leaders).toEqual(sample);
    expect(result.current.error).toBeNull();
  });

  it('sets an error when the response is not ok and there is no cache', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const { result } = renderHook(() => useLeaders('nba'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load leaders');
    expect(result.current.leaders).toEqual([]);
  });

  it('sets an error when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useLeaders('nba'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network');
  });

  it('does not fetch and returns empty when comp is null (scoreboard-sourced comps)', () => {
    const { result } = renderHook(() => useLeaders(null));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.leaders).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // Finding 1: navigating eng.1 → nba on the SAME hook instance (FixturesView
  // re-renders with a new comp) must not republish eng.1's cached leaders,
  // and must not suppress a real nba failure against that stale cache.
  it('does not leak the previous comp cache and fails closed when the new comp errors', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sample });
    const { result, rerender } = renderHook(
      ({ comp }: { comp: string | null }) => useLeaders(comp),
      {
        initialProps: { comp: 'eng.1' },
      },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leaders).toEqual(sample);

    fetchMock.mockRejectedValueOnce(new Error('nba network down'));
    rerender({ comp: 'nba' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leaders).toEqual([] as Leader[]);
    expect(result.current.error).toBe('nba network down');
  });

  it('skips the first fetch when initialData is provided and non-empty', async () => {
    const seed: Leader[] = [
      {
        rank: 1,
        name: 'Seeded',
        teamName: 'X',
        teamLogo: '',
        displayValue: '10',
        value: 10,
      },
    ];
    const { result } = renderHook(() => useLeaders('nba', seed));
    expect(result.current.loading).toBe(false);
    expect(result.current.leaders).toEqual(seed);
    expect(result.current.error).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
