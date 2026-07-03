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
export function useLeaders(comp: string | null) {
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [loading, setLoading] = useState(!!comp);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: Leader[]; ts: number } | null>(null);
  const initialRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!comp) return;
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
    document.addEventListener('visibilitychange', onVisibility);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 60_000);
    return () => {
      abortRef.current?.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [comp, fetchData]);

  return { leaders, loading, error, refetch: fetchData };
}
