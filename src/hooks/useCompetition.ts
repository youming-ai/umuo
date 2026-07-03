import { useCallback, useEffect, useRef, useState } from 'react';
import { getAdapter } from '../adapters';
import type { StandingsData } from '../adapters/types';
import type { CompMatch, TopScorer } from '../types';

export function useCompetition(comp: string) {
  const BASE = `/api/${comp}`;
  const [matches, setMatches] = useState<CompMatch[]>([]);
  const [standings, setStandings] = useState<StandingsData>({ kind: 'soccer', groups: [] });
  const [scorers, setScorers] = useState<TopScorer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{
    matches: CompMatch[];
    standings: StandingsData;
    scorers: TopScorer[];
    ts: number;
  } | null>(null);
  const initialRef = useRef(true);
  const compRef = useRef(comp);

  const fetchAll = useCallback(async () => {
    // On a competition change, drop the previous comp's cache + displayed state
    // so we never serve one competition's matches/standings/scorers on another's
    // tab, and never suppress the new comp's fetch error against a stale cache.
    // Guarded by compRef so same-comp polls/refetches keep their SWR behavior.
    if (compRef.current !== comp) {
      compRef.current = comp;
      cacheRef.current = null;
      initialRef.current = true;
      setMatches([]);
      setStandings({ kind: 'soccer', groups: [] });
      setScorers([]);
    }
    // stale-while-revalidate: show cached data immediately on subsequent fetches
    if (cacheRef.current && !initialRef.current) {
      setMatches(cacheRef.current.matches);
      setStandings(cacheRef.current.standings);
      setScorers(cacheRef.current.scorers);
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
      const [sbRes, stRes] = await Promise.all([
        fetch(`${BASE}/scoreboard`, { signal }),
        fetch(`${BASE}/standings`, { signal }),
      ]);
      if (signal.aborted) return;
      if (!sbRes.ok || !stRes.ok) throw new Error('Failed to load World Cup data');
      const [sbJson, stJson] = await Promise.all([sbRes.json(), stRes.json()]);

      const adapter = getAdapter(comp);
      const { matches: ms, standings: sd, scorers: sc } = adapter.transform(sbJson, stJson);

      if (signal.aborted) return;
      cacheRef.current = { matches: ms, standings: sd, scorers: sc, ts: Date.now() };
      setMatches(ms);
      setStandings(sd);
      setScorers(sc);
      setError(null);
    } catch (err: unknown) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      console.error('useCompetition fetch failed:', err);
      if (!cacheRef.current)
        setError(err instanceof Error ? err.message : 'Failed to load World Cup data');
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        initialRef.current = false;
      }
    }
  }, [BASE, comp]);

  useEffect(() => {
    fetchAll();
    // Poll every 30s when tab is visible, pause when hidden
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchAll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchAll();
    }, 30_000);
    return () => {
      abortRef.current?.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchAll]);

  return { matches, standings, scorers, loading, error, refetch: fetchAll };
}
