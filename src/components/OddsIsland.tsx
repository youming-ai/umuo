import type { StandingsData } from '../adapters/types';
import type { CompMatch, TopScorer } from '../types';
import { useCompetition } from '../hooks/useCompetition';
import AppProviders from './AppProviders';
import OddsView from './OddsView';

interface CompetitionInitialData {
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
}

// Odds tab island. Reuses the scoreboard SWR loop (odds ride along on each
// CompMatch) so lines refresh with the same visibility-gated poll as the
// Matches view; no dedicated fetch/endpoint.
function OddsIslandInner({
  comp,
  initialData,
}: {
  comp: string;
  initialData: CompetitionInitialData;
}) {
  const { matches, loading, error, refetch } = useCompetition(comp, initialData);

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

  return <OddsView matches={matches} />;
}

export default function OddsIsland({
  comp,
  initialData,
}: {
  comp: string;
  initialData: CompetitionInitialData;
}) {
  return (
    <AppProviders>
      <OddsIslandInner comp={comp} initialData={initialData} />
    </AppProviders>
  );
}
