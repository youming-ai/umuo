import { useCallback } from 'react';
import { getAdapter } from '../adapters';
import type { MatchDetail } from '../adapters/types';
import { usePolledResource } from './usePolledResource';

export function useMatchDetail(
  eventId: string | null,
  comp: string,
  initialData?: MatchDetail | null,
) {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<MatchDetail | null> => {
      if (!eventId) return null;
      const res = await fetch(`/api/${comp}/summary?event=${eventId}`, { signal });
      if (!res.ok) throw new Error('Failed to load match detail');
      const json: unknown = await res.json();
      return getAdapter(comp).transformSummary(json);
    },
    [eventId, comp],
  );

  const {
    data: detail,
    loading,
    error,
    refetch: reload,
  } = usePolledResource<MatchDetail | null>({
    fetcher,
    key: `${comp}:${eventId}`,
    fallback: null,
    initialData: initialData ?? undefined,
    skip: !eventId,
    // No interval: the hero (score/status/clock/shootout) renders the immutable
    // `match` prop, so polling the summary refreshed the tabs while the hero
    // stayed frozen — live-looking but wrong. Fetch-once + explicit reload.
    // Upgrade path: poll the scoreboard and merge that into the hero, then a
    // summary interval earns its place again.
  });

  return { detail, loading, error, reload };
}
