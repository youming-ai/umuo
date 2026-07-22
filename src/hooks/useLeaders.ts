import type { Leader } from '../types';
import { usePolledResource } from './usePolledResource';

// Season leaders (eng.1 goals / nba points) from the server-side pipeline
// (/api/<comp>/leaders → Worker → assembleLeaders). `comp` is `string | null`:
// the caller passes null for comps with no leaders pipeline so this never
// fetches. Thin wrapper over usePolledResource: 60s poll, reset on comp change.
export function useLeaders(comp: string | null, initialData?: Leader[]) {
  const seeded = initialData !== undefined;
  const { data, loading, error, refetch } = usePolledResource<Leader[]>({
    key: comp ?? '',
    skip: !comp,
    fallback: [],
    initialData: seeded ? initialData : undefined,
    intervalMs: 60_000,
    fetcher: async (signal) => {
      const res = await fetch(`/api/${comp}/leaders`, { signal });
      if (!res.ok) throw new Error('Failed to load leaders');
      const raw = await res.json();
      return Array.isArray(raw) ? (raw as Leader[]) : [];
    },
  });
  return { leaders: data, loading, error, refetch };
}
