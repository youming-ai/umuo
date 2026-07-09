import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsItem } from '../types';
import { useNews } from './useNews';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const feed = {
  headlines: [
    {
      id: 1,
      headline: 'Hello',
      description: 'd',
      published: '2026-07-07T00:00:00Z',
      byline: 'ESPN',
      images: [],
      links: { web: { href: 'https://espn.com/1' } },
      categories: [],
    },
  ],
};

describe('useNews', () => {
  it('fetches /api/news for the all scope and exposes parsed items', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => feed });
    const { result } = renderHook(() => useNews({ by: 'all' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/news', expect.any(Object));
    expect(result.current.items[0].headline).toBe('Hello');
    expect(result.current.error).toBeNull();
  });

  it('builds the query for sport/league/team scopes', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ headlines: [] }) });
    renderHook(() => useNews({ by: 'league', league: 'nba' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/news?leagues=nba', expect.any(Object)),
    );
  });

  it('sets an error when the response is not ok and there is no cache', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const { result } = renderHook(() => useNews({ by: 'sport', sport: 'soccer' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load news');
    expect(result.current.items).toEqual([]);
  });

  it('builds the query for the sport scope', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ headlines: [] }) });
    renderHook(() => useNews({ by: 'sport', sport: 'soccer' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/news?sport=soccer', expect.any(Object)),
    );
  });

  it('builds the query for the team scope', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ headlines: [] }) });
    renderHook(() => useNews({ by: 'team', team: 'lal' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/news?team=lal', expect.any(Object)),
    );
  });

  it('skips the first fetch when initialData is provided and non-empty', async () => {
    const seed: NewsItem[] = [
      {
        id: 'seed-1',
        headline: 'Seeded headline',
        description: 'd',
        published: '2026-07-07T00:00:00Z',
        byline: 'ESPN',
        imageUrl: '',
        link: 'https://espn.com/seed',
        tags: [],
      },
    ];
    const { result } = renderHook(() => useNews({ by: 'all' }, seed));
    // synchronous: the seeded state is visible without waiting for any fetch
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual(seed);
    expect(result.current.error).toBeNull();
    // wait one tick for any effect to settle; the fetch must NOT have happened
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
