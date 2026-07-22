import CompetitionDataIsland, { type CompetitionInitialData } from './CompetitionDataIsland';
import OddsView from './OddsView';

// Odds tab island: the shared competition-data loop with OddsView as the leaf.
// Odds ride along on each CompMatch from the scoreboard, so lines refresh with
// the same visibility-gated poll as the Matches view — no dedicated endpoint.
export default function OddsIsland({
  comp,
  initialData,
}: {
  comp: string;
  initialData: CompetitionInitialData;
}) {
  return (
    <CompetitionDataIsland comp={comp} initialData={initialData}>
      {({ matches }) => <OddsView matches={matches} />}
    </CompetitionDataIsland>
  );
}
