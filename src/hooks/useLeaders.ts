import { useCallback, useEffect, useRef, useState } from 'react';
import type { Leader } from '../types';

// Season leaders (eng.1 goals / nba points) from the server-side pipeline
// (/api/<comp>/leaders → Worker cachedProducer → assembleLeaders). Only called
// when COMPETITIONS[comp].leadersSource === 'pipeline' (the World Cup keeps its
// scoreboard-sourced scorers). `comp` is `string | null` (mirrors
// useMatchDetail's `eventId: string | null`) — the caller passes null for
// scoreboard-sourced comps so this never fetches or polls for a result that
// would be discarded. Same SWR + visibility-gated polling + AbortController
// pattern as useStreams; season stats change slowly so we poll at 60s.
export function useLeaders(comp: string | null, initialData?: Leader[]) {
  const seeded = !!initialData && initialData.length > 0;
  const [leaders, setLeaders] = useState<Leader[]>(initialData ?? []);
  const [loading, setLoading] = useState(!!comp && !seeded);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: Leader[]; ts: number } | null>(
    seeded ? { data: initialData, ts: Date.now() } : null,
  );
  const initialRef = useRef(true);
  // Tracks which comp the cache/initial-load state above belongs to. When
  // `comp` changes (e.g. FixturesView re-renders eng.1 → nba on the same hook
  // instance), the previous comp's cache must never be served for the new
  // comp, and a new-comp failure must not be suppressed against it — reset to
  // a clean initial-load state per comp (Finding 1).
  const compRef = useRef<string | null>(comp);

  const fetchData = useCallback(async () => {
    if (!comp) return;
    if (compRef.current !== comp) {
      compRef.current = comp;
      cacheRef.current = null;
      initialRef.current = true;
      setLeaders([]);
    }
    // If we have seed data and this is the first call for this comp (no
    // comp change just happened), the seed IS the first-paint data — mark
    // initialRef false and skip the actual fetch. The comp-change path
    // above already cleared the seed (cacheRef = null) and reset
    // initialRef = true, so a real comp change with no seed for the new
    // comp falls through to the fetch below.
    if (initialRef.current && cacheRef.current) {
      initialRef.current = false;
      return;
    }
    if (cacheRef.current && !initialRef.current) {
      setLeaders(cacheRef.current.data);
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
      const res = await fetch(`/api/${comp}/leaders`, { signal });
      if (signal.aborted) return;
      if (!res.ok) throw new Error('Failed to load leaders');
      const raw = await res.json();
      const data = Array.isArray(raw) ? (raw as Leader[]) : [];
      if (signal.aborted) return;
      cacheRef.current = { data, ts: Date.now() };
      setLeaders(data);
      setError(null);
    } catch (err: unknown) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      console.error('useLeaders fetch failed:', err);
      if (!cacheRef.current)
        setError(err instanceof Error ? err.message : 'Failed to load leaders');
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        initialRef.current = false;
      }
    }
  }, [comp]);

  useEffect(() => {
    if (!comp) return;
    fetchData();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 60_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      abortRef.current?.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [comp, fetchData]);

  return { leaders, loading, error, refetch: fetchData };
}
