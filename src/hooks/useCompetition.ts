import { getAdapter } from '../adapters';
import type { StandingsData } from '../adapters/types';
import { COMPETITIONS } from '../competitions';
import type { CompMatch } from '../types';
import { usePolledResource } from './usePolledResource';

interface CompetitionData {
  matches: CompMatch[];
  standings: StandingsData;
}

function empty(comp: string): CompetitionData {
  return {
    matches: [],
    standings:
      COMPETITIONS[comp]?.sport === 'basketball'
        ? { kind: 'basketball', conferences: [] }
        : { kind: 'soccer', groups: [] },
  };
}

// Fixtures + standings for a competition (scoreboard + standings, folded through
// the sport adapter). Thin wrapper over usePolledResource: 30s poll, reset on
// comp change. `skip` pauses it entirely for consumers that don't read the data
// (e.g. a rail with standings hidden) instead of duplicating the fetch.
export function useCompetition(comp: string, initialData?: CompetitionData, skip = false) {
  const { data, loading, error, refetch } = usePolledResource<CompetitionData>({
    key: comp,
    fallback: empty(comp),
    // Seed on ANY initialData: an off-day / off-season scoreboard is legitimately
    // empty, and treating that as "unseeded" showed a spinner and refetched what
    // SSR already sent.
    initialData,
    intervalMs: 30_000,
    skip,
    fetcher: async (signal) => {
      const [sbRes, stRes] = await Promise.all([
        fetch(`/api/${comp}/scoreboard`, { signal }),
        fetch(`/api/${comp}/standings`, { signal }),
      ]);
      // Independent upstreams: only a scoreboard failure is fatal. The adapter
      // tolerates `{}` standings, so a standings blip no longer discards live
      // scores.
      // ponytail: a standings-only failure blanks the standings panel until the
      // next successful poll (30s). Hold the last good standings in a ref if that
      // flicker ever matters.
      if (!sbRes.ok) throw new Error('Failed to load fixtures');
      const [sbJson, stJson] = await Promise.all([sbRes.json(), stRes.ok ? stRes.json() : {}]);
      const { matches, standings } = getAdapter(comp).transform(sbJson, stJson);
      return { matches, standings };
    },
  });
  return { matches: data.matches, standings: data.standings, loading, error, refetch };
}
