import { useCallback, useEffect, useRef, useState } from 'react';
import { getAdapter } from '../adapters';
import type { MatchDetail } from '../adapters/types';

export function useMatchDetail(
  eventId: string | null,
  comp: string,
  initialData?: MatchDetail | null,
) {
  const seeded = !!initialData;
  const [detail, setDetail] = useState<MatchDetail | null>(initialData ?? null);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);
  // `attempt` is intentionally unused in the body — `reload()` bumps it to
  // re-trigger the fetch effect. The biome lint rule on the deps array below
  // acknowledges this pattern.
  const [attempt, setAttempt] = useState(0);
  const skipRef = useRef(seeded);
  // Last successful detail, retained so a transient reload failure keeps the
  // panel populated instead of blanking it (keep-stale-on-failure contract,
  // same idiom as useCompetition/useNews/useLeaders).
  const cacheRef = useRef<MatchDetail | null>(initialData ?? null);
  // `${comp}:${eventId}` key — when it changes (different match) we drop the
  // stale cache so we never show the previous match's detail.
  const keyRef = useRef(`${comp}:${eventId}`);

  // biome-ignore lint/correctness/useExhaustiveDependencies(attempt): bumped by reload() to force a re-fetch
  useEffect(() => {
    const key = `${comp}:${eventId}`;
    if (keyRef.current !== key) {
      keyRef.current = key;
      cacheRef.current = null;
      setDetail(null);
      setError(null);
      // A different match must always fetch — never carry over the seed-skip
      // from the initially-seeded event (e.g. if the first run returned via
      // the `!eventId` branch before consuming skipRef).
      skipRef.current = false;
    }
    if (!eventId) {
      cacheRef.current = null;
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
    // NOTE: detail is intentionally NOT cleared here — stale data stays on
    // screen while we refresh, and is kept if the refresh fails.

    fetch(`/api/${comp}/summary?event=${eventId}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load match detail');
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        const transformed = getAdapter(comp).transformSummary(json);
        cacheRef.current = transformed;
        setDetail(transformed);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError'))
          return;
        // Raw message is for the console/internal only; the UI surfaces a user-facing string.
        console.error('useMatchDetail:', err);
        // Keep the stale detail (still in state) when we have one; only surface
        // an error when there's nothing to show.
        if (!cacheRef.current)
          setError(err instanceof Error ? err.message : 'Failed to load match detail');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [eventId, attempt, comp]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { detail, loading, error, reload };
}
