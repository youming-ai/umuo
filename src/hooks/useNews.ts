import { useCallback, useEffect, useRef, useState } from 'react';
import { parseNewsFeed } from '../newsFeed';
import type { NewsItem, NewsScope } from '../types';

// The /api/news query for a scope. /api/news filters by sport/leagues/team;
// the 'all' scope sends no filter. (leagues is plural — Phase-1 whitelist.)
function scopeToQuery(s: NewsScope): string {
  if (s.by === 'sport') return `?sport=${encodeURIComponent(s.sport)}`;
  if (s.by === 'league') return `?leagues=${encodeURIComponent(s.league)}`;
  if (s.by === 'team') return `?team=${encodeURIComponent(s.team)}`;
  return '';
}

// News feed for the current scope. Same SWR + visibility-gated polling +
// AbortController idiom as useLeaders; news changes moderately, so poll 120s
// (matches the Worker's global-news fresh window). Resets cache when the scope
// changes so one scope's feed never flashes on another.
export function useNews(scope: NewsScope) {
  const query = scopeToQuery(scope);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: NewsItem[]; ts: number } | null>(null);
  const initialRef = useRef(true);
  const queryRef = useRef(query);

  const fetchData = useCallback(async () => {
    if (queryRef.current !== query) {
      queryRef.current = query;
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
      const res = await fetch(`/api/news${query}`, { signal });
      if (signal.aborted) return;
      if (!res.ok) throw new Error('Failed to load news');
      const json = await res.json();
      if (signal.aborted) return;
      const data = parseNewsFeed(json);
      cacheRef.current = { data, ts: Date.now() };
      initialRef.current = false;
      setItems(data);
      setError(null);
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      if (!cacheRef.current) setError('Failed to load news');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    fetchData();
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
  }, [fetchData]);

  return { items, loading, error, refetch: fetchData };
}
