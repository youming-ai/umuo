import { parseNewsFeed } from '../newsFeed';
import type { NewsItem } from '../types';
import { usePolledResource } from './usePolledResource';

// Per-competition news feed (same-origin /api/<comp>/news, ESPN's site.api
// league feed via the Worker). Thin wrapper over usePolledResource: 120s poll,
// reset on comp change.
export function useNews(comp: string, initialData?: NewsItem[]) {
  const seeded = initialData !== undefined;
  const { data, loading, error, refetch } = usePolledResource<NewsItem[]>({
    key: comp,
    fallback: [],
    initialData: seeded ? initialData : undefined,
    intervalMs: 120_000,
    fetcher: async (signal) => {
      const res = await fetch(`/api/${comp}/news`, { signal });
      if (!res.ok) throw new Error('Failed to load news');
      return parseNewsFeed(await res.json());
    },
  });
  return { items: data, loading, error, refetch };
}
