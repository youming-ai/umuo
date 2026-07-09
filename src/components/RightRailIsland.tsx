import type { CompMatch, TopScorer } from '../types';
import type { StandingsData } from '../adapters/types';
import { useCompetition } from '../hooks/useCompetition';
import AppProviders from './AppProviders';
import RightRail from './RightRail';

interface InitialData {
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
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
  const { standings, scorers } = useCompetition(comp, initialData);

  return (
    <AppProviders>
      <RightRail comp={comp} standings={standings} scorers={scorers} />
    </AppProviders>
  );
}