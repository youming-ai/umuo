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
  articles: [
    {
      id: 1,
      headline: 'Hello',
      description: 'd',
      published: '2026-07-07T00:00:00Z',
      byline: 'ESPN',
      images: [{ url: 'https://a/x.jpg' }],
      links: { web: { href: 'https://www.espn.com/story/1' } },
      categories: [],
    },
  ],
};

const seed: NewsItem[] = [
  {
    id: 'seed-1',
    headline: 'Seeded',
    description: '',
    published: '',
    byline: '',
    imageUrl: '',
    link: '',
    tags: [],
  },
];

describe('useNews', () => {
  it('fetches /api/<comp>/news and exposes parsed items', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => feed });
    const { result } = renderHook(() => useNews('eng.1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/eng.1/news', expect.any(Object));
    expect(result.current.items[0].headline).toBe('Hello');
    expect(result.current.error).toBeNull();
  });

  it('targets the competition-specific route per comp', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ articles: [] }) });
    renderHook(() => useNews('nba'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/nba/news', expect.any(Object)),
    );
  });

  it('sets an error when the response is not ok and there is no cache', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const { result } = renderHook(() => useNews('eng.1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load news');
    expect(result.current.items).toEqual([]);
  });

  it('skips the first fetch when initialData is provided and non-empty', async () => {
    const { result } = renderHook(() => useNews('eng.1', seed));
    // synchronous: the seeded state is visible without waiting for any fetch
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual(seed);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the new comp immediately when a seeded hook changes comp', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => feed });
    const { rerender, result } = renderHook(({ comp }: { comp: string }) => useNews(comp, seed), {
      initialProps: { comp: 'eng.1' },
    });
    rerender({ comp: 'nba' });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/nba/news', expect.any(Object)),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items[0].headline).toBe('Hello');
  });
});
