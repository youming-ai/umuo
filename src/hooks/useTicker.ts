import { useCallback, useEffect, useRef, useState } from 'react';
import { getAdapter } from '../adapters';
import { COMPETITIONS } from '../competitions';
import type { CompMatch } from '../types';
import { marqueeMatches } from '../utils/marquee';

export type TickerMatch = CompMatch & { comp: string };

// Cross-competition scoreboard strip for the global ticker. Fetches every
// registered competition's scoreboard in parallel (worker KV-cached), merges,
// and selects via marqueeMatches. No ppv.st — ESPN only.
export function useTicker() {
  const [items, setItems] = useState<TickerMatch[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      const comps = Object.keys(COMPETITIONS);
      const batches = await Promise.all(
        comps.map(async (comp) => {
          const res = await fetch(`/api/${comp}/scoreboard`, { signal });
          if (!res.ok) return [] as TickerMatch[];
          const json = await res.json();
          const { matches } = getAdapter(comp).transform(json, {});
          return matches.map((m) => ({ ...m, comp }));
        }),
      );
      if (signal.aborted) return;
      const merged = batches.flat();
      setItems(marqueeMatches(merged, Date.now()) as TickerMatch[]);
    } catch (err: unknown) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      console.error('useTicker fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchAll();
    };
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchAll();
    }, 30_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      abortRef.current?.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchAll]);

  return { items };
}