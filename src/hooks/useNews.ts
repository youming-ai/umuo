import { useCallback, useEffect, useRef, useState } from 'react';
import { parseNewsFeed } from '../newsFeed';
import type { NewsItem } from '../types';

// Per-competition news feed. Fetches the same-origin `/api/<comp>/news` (ESPN's
// site.api league feed via the Worker). Same SWR + visibility-gated polling +
// AbortController idiom as useLeaders; news changes moderately, so poll at 120s.
// Resets cache when `comp` changes so one competition's feed never flashes on
// another.
export function useNews(comp: string, initialData?: NewsItem[]) {
  const seeded = !!initialData && initialData.length > 0;
  const [items, setItems] = useState<NewsItem[]>(initialData ?? []);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: NewsItem[]; ts: number } | null>(
    seeded ? { data: initialData, ts: Date.now() } : null,
  );
  const initialRef = useRef(!seeded);
  const compRef = useRef(comp);

  const fetchData = useCallback(async () => {
    if (compRef.current !== comp) {
      compRef.current = comp;
      cacheRef.current = null;
      initialRef.current = true;
      setItems([]);
    }
    if (cacheRef.current && !initialRef.current) {
      setItems(cacheRef.current.data);
      setLoading(false);
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    if (initialRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch(`/api/${comp}/news`, { signal });
      if (signal.aborted) return;
      if (!res.ok) throw new Error('Failed to load news');
      const json = await res.json();
      if (signal.aborted) return;
      const data = parseNewsFeed(json);
      cacheRef.current = { data, ts: Date.now() };
      setItems(data);
      setError(null);
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      console.error('[useNews] fetch failed:', err);
      if (!cacheRef.current) setError('Failed to load news');
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        initialRef.current = false;
      }
    }
  }, [comp]);

  useEffect(() => {
    if (initialRef.current || compRef.current !== comp) fetchData();
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 120_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      abortRef.current?.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchData, comp]);

  return { items, loading, error, refetch: fetchData };
}
