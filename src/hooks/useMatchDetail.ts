import { useEffect, useRef, useState } from 'react';
import { getAdapter } from '../adapters';
import type { MatchDetail } from '../adapters/types';

export function useMatchDetail(eventId: string | null, comp: string, initialData?: MatchDetail | null) {
  const seeded = !!initialData;
  const [detail, setDetail] = useState<MatchDetail | null>(initialData ?? null);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);
  // `attempt` is intentionally unused in the body — `reload()` bumps it to
  // re-trigger the fetch effect. The biome lint rule on the deps array below
  // acknowledges this pattern.
  const [attempt, setAttempt] = useState(0);
  const skipRef = useRef(seeded);
  // biome-ignore lint/correctness/useExhaustiveDependencies(attempt): bumped by reload() to force a re-fetch
  useEffect(() => {
    if (!eventId) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);

    fetch(`/api/${comp}/summary?event=${eventId}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load match detail');
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        setDetail(getAdapter(comp).transformSummary(json));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError'))
          return;
        // Raw message is for the console/internal only; the UI surfaces a user-facing string.
        console.error('useMatchDetail:', err);
        setError(err instanceof Error ? err.message : 'Failed to load match detail');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [eventId, attempt, comp]);

  const reload = () => setAttempt((n) => n + 1);

  return { detail, loading, error, reload };
}
