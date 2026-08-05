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
  hide,
}: {
  comp: string;
  initialData?: InitialData;
  hide?: 'standings' | 'scorers';
}) {
  // hide="standings" means the rail renders nothing from this hook, so don't run
  // it — the schedule/odds pages already mount a center island polling the same
  // scoreboard+standings every 30s.
  const { standings, loading, error, refetch } = useCompetition(
    comp,
    initialData,
    hide === 'standings',
  );

  return (
    <RightRail
      comp={comp}
      hide={hide}
      standings={standings}
      standingsLoading={loading}
      standingsError={error}
      onStandingsRetry={refetch}
    />
  );
}
