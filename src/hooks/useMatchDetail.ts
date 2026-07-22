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
    intervalMs: 30_000,
  });

  return { detail, loading, error, reload };
}
