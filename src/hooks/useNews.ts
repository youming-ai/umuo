import { COMPETITIONS } from '../competitions';
import { parseNewsFeed, prioritizeNewsForComp } from '../newsFeed';
import type { NewsItem } from '../types';
import { usePolledResource } from './usePolledResource';

// Per-competition news feed (same-origin /api/<comp>/news, ESPN's site.api
// league feed via the Worker). Thin wrapper over usePolledResource: 120s poll,
// reset on comp change. The API returns raw ESPN order, so we re-apply the same
// competition prioritization the SSR composer uses on every poll.
export function useNews(comp: string, initialData?: NewsItem[]) {
  const seeded = !!initialData && initialData.length > 0;
  const compConfig = COMPETITIONS[comp];
  const { data, loading, error, refetch } = usePolledResource<NewsItem[]>({
    key: comp,
    fallback: [],
    initialData: seeded ? initialData : undefined,
    intervalMs: 120_000,
    fetcher: async (signal) => {
      const res = await fetch(`/api/${comp}/news`, { signal });
      if (!res.ok) throw new Error('Failed to load news');
      const items = parseNewsFeed(await res.json());
      return compConfig ? prioritizeNewsForComp(items, compConfig) : items;
    },
  });
  return { items: data, loading, error, refetch };
}
