import type { StandingsData } from '../adapters/types';
import type { CompMatch, TopScorer } from '../types';
import { useCompetition } from '../hooks/useCompetition';
import FixturesView from './FixturesView';
import AppProviders from './AppProviders';

interface CompetitionInitialData {
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
}

function CompetitionIslandInner({
  comp,
  initialData,
}: {
  comp: string;
  initialData: CompetitionInitialData;
}) {
  const { matches, standings, loading, error, refetch } = useCompetition(comp, initialData);

  if (error && matches.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="font-mono text-xs tracking-wider text-chalkdim">{error}</p>
        <button
          type="button"
          onClick={refetch}
          className="px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide hover:brightness-110 ds-press"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading && matches.length === 0) {
    return (
      <p className="font-mono text-xs tracking-[0.3em] text-pitch animate-pulse motion-reduce:animate-none">
        Loading…
      </p>
    );
  }

  return <FixturesView matches={matches} standings={standings} />;
}

export default function CompetitionIsland({
  comp,
  initialData,
}: {
  comp: string;
  initialData: CompetitionInitialData;
}) {
  return (
    <AppProviders>
      <CompetitionIslandInner comp={comp} initialData={initialData} />
    </AppProviders>
  );
}
