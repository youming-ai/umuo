import { useCallback, useEffect, useRef, useState } from 'react';

// The shared stale-while-revalidate + AbortController + visibility-gated poll
// engine behind useCompetition / useNews / useLeaders / useMatchDetail. A wrapper supplies:
//   - fetcher(signal): does the actual fetch(es) + parse/transform, throws on failure
//   - key: reset trigger — when it changes (e.g. comp switch) the cache and
//     displayed state drop so one key's data never flashes on another's
//   - fallback: the empty value shown on reset (e.g. [] or {kind:'soccer',groups:[]})
//   - initialData: SSR seed (omit / undefined = not seeded → shows loading)
//   - intervalMs: poll cadence; skip: pause entirely (e.g. no comp selected)
export function usePolledResource<T>(opts: {
  fetcher: (signal: AbortSignal) => Promise<T>;
  key: string;
  fallback: T;
  initialData?: T;
  intervalMs?: number;
  skip?: boolean;
}): { data: T; loading: boolean; error: string | null; refetch: () => void } {
  const { key, fallback, initialData, intervalMs, skip = false } = opts;
  const seeded = initialData !== undefined;

  const [data, setData] = useState<T>(initialData ?? fallback);
  const [loading, setLoading] = useState(!skip && !seeded);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: T } | null>(seeded ? { data: initialData as T } : null);
  const initialRef = useRef(true);
  const keyRef = useRef(key);
  // fetcher/fallback are fresh closures every render; hold them in refs so
  // `refetch` only re-identifies on key/skip changes (not every render, which
  // would restart the poll loop each render).
  const fetcherRef = useRef(opts.fetcher);
  fetcherRef.current = opts.fetcher;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const refetch = useCallback(async () => {
    if (skip) return;
    // Key change: drop the previous key's cache + displayed state so we never
    // serve it for the new key, and never suppress a new-key error against it.
    if (keyRef.current !== key) {
      keyRef.current = key;
      cacheRef.current = null;
      initialRef.current = true;
      setData(fallbackRef.current);
    }
    // Seeded first paint for this key: the seed IS the first data — consume it
    // without a network round-trip.
    if (initialRef.current && cacheRef.current) {
      initialRef.current = false;
      return;
    }
    // SWR: show cached immediately on subsequent fetches while revalidating.
    if (cacheRef.current && !initialRef.current) {
      setData(cacheRef.current.data);
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
      const result = await fetcherRef.current(signal);
      if (signal.aborted) return;
      cacheRef.current = { data: result };
      setData(result);
      setError(null);
    } catch (err: unknown) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      console.error('usePolledResource fetch failed:', err);
      // keep-stale-on-failure: only surface an error when there's no cache to show.
      if (!cacheRef.current) setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        initialRef.current = false;
      }
    }
  }, [key, skip]);

  useEffect(() => {
    if (skip) return;
    refetch();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    const id = intervalMs
      ? setInterval(() => {
          if (document.visibilityState === 'visible') refetch();
        }, intervalMs)
      : null;
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      abortRef.current?.abort();
      if (id != null) clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refetch, skip, intervalMs]);

  return { data, loading, error, refetch };
}
