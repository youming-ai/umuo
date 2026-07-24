import type { StandingsData } from '../adapters/types';
import { useCompetition } from '../hooks/useCompetition';
import type { CompMatch } from '../types';
import RightRail from './RightRail';

interface InitialData {
  matches: CompMatch[];
  standings: StandingsData;
}

// Right-rail as a self-contained island. Pages that already SSR a competition
// view pass initialData so the first paint is warm; otherwise self-fetches.
export default function RightRailIsland({
  comp,
  initialData,
}: {
  comp: string;
  initialData?: InitialData;
}) {
  const { standings, loading, error, refetch } = useCompetition(comp, initialData);

  return (
    <RightRail
      comp={comp}
      standings={standings}
      standingsLoading={loading}
      standingsError={error}
      onStandingsRetry={refetch}
    />
  );
}
