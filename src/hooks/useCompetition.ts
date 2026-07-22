import { getAdapter } from '../adapters';
import type { StandingsData } from '../adapters/types';
import type { CompMatch } from '../types';
import { usePolledResource } from './usePolledResource';

interface CompetitionData {
  matches: CompMatch[];
  standings: StandingsData;
}

const EMPTY: CompetitionData = { matches: [], standings: { kind: 'soccer', groups: [] } };

// Fixtures + standings for a competition (scoreboard + standings, folded through
// the sport adapter). Thin wrapper over usePolledResource: 30s poll, reset on
// comp change.
export function useCompetition(comp: string, initialData?: CompetitionData) {
  const seeded = initialData !== undefined;
  const { data, loading, error, refetch } = usePolledResource<CompetitionData>({
    key: comp,
    fallback: EMPTY,
    initialData: seeded ? initialData : undefined,
    intervalMs: 30_000,
    fetcher: async (signal) => {
      const [sbRes, stRes] = await Promise.all([
        fetch(`/api/${comp}/scoreboard`, { signal }),
        fetch(`/api/${comp}/standings`, { signal }),
      ]);
      if (!sbRes.ok || !stRes.ok) throw new Error('Failed to load fixtures');
      const [sbJson, stJson] = await Promise.all([sbRes.json(), stRes.json()]);
      const { matches, standings } = getAdapter(comp).transform(sbJson, stJson);
      return { matches, standings };
    },
  });
  return { matches: data.matches, standings: data.standings, loading, error, refetch };
}
