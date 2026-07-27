import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { MatchDetail } from '../adapters/types';
import { useMatchDetail } from './useMatchDetail';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
});

it('does not fetch when eventId is null', () => {
  renderHook(() => useMatchDetail(null, 'eng.1'));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('fetches and parses the summary for an event id', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      header: { competitions: [{ competitors: [{ homeAway: 'home', team: { id: '1' } }] }] },
      boxscore: { teams: [] },
      gameInfo: { attendance: 100 },
    }),
  });
  const { result } = renderHook(() => useMatchDetail('760420', 'eng.1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(fetchMock).toHaveBeenCalledWith('/api/eng.1/summary?event=760420', expect.any(Object));
  expect(result.current.detail?.homeId).toBe('1');
  expect(result.current.error).toBeNull();
});

it('surfaces an error when the request fails', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false });
  const { result } = renderHook(() => useMatchDetail('1', 'eng.1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBeTruthy();
  expect(result.current.detail).toBeNull();
});

it('refetches on reload() and populates detail on success', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      header: { competitions: [{ competitors: [{ homeAway: 'home', team: { id: '7' } }] }] },
      boxscore: { teams: [] },
      gameInfo: {},
    }),
  });
  const { result } = renderHook(() => useMatchDetail('1', 'eng.1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(async () => result.current.reload());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.error).toBeNull();
  expect(result.current.detail?.homeId).toBe('7');
});

it('keeps stale detail when a reload fails after a successful fetch', async () => {
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        header: { competitions: [{ competitors: [{ homeAway: 'home', team: { id: '1' } }] }] },
        boxscore: { teams: [] },
        gameInfo: {},
      }),
    })
    .mockResolvedValueOnce({ ok: false });
  const { result } = renderHook(() => useMatchDetail('1', 'eng.1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.detail?.homeId).toBe('1');
  expect(result.current.error).toBeNull();

  await act(async () => result.current.reload());
  await waitFor(() => expect(result.current.loading).toBe(false));
  // Stale detail is retained; no error surfaced since we still have data to show.
  expect(result.current.detail?.homeId).toBe('1');
  expect(result.current.error).toBeNull();
});

it('skips the first fetch when initialData is provided (non-null)', async () => {
  const seed: MatchDetail = {
    kind: 'soccer',
    homeId: '1',
    awayId: '2',
    stats: [],
    allPlays: [],
    keyPlays: [],
    lineups: [],
    venue: '',
    attendance: null,
    odds: null,
    form: [],
  };
  const { result } = renderHook(() => useMatchDetail('760420', 'eng.1', seed));
  expect(result.current.loading).toBe(false);
  expect(result.current.detail).toEqual(seed);
  expect(result.current.error).toBeNull();
  await new Promise((r) => setTimeout(r, 10));
  expect(fetchMock).not.toHaveBeenCalled();
});
