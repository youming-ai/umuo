import CompetitionDataIsland, { type CompetitionInitialData } from './CompetitionDataIsland';
import FixturesView from './FixturesView';

// Matches/schedule island: the shared competition-data loop with FixturesView
// as the leaf.
export default function CompetitionIsland({
  comp,
  initialData,
}: {
  comp: string;
  initialData: CompetitionInitialData;
}) {
  return (
    <CompetitionDataIsland comp={comp} initialData={initialData}>
      {({ matches, standings }) => <FixturesView matches={matches} standings={standings} />}
    </CompetitionDataIsland>
  );
}
