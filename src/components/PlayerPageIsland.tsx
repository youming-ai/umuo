import type { CompMatch, TopScorer, Group } from '../types';
import { useRouter, pathFor } from '../utils/router';
import PlayerPage from './PlayerPage';
import AppProviders from './AppProviders';

// Thin island wrapper. Passes schedule up-link + SSR-fetched data through to
// PlayerPage. client:only — none of the React hooks run server-side.
export default function PlayerPageIsland({
  athleteId,
  groups,
  matches,
  scorers,
}: {
  athleteId: string;
  groups: Group[];
  matches: CompMatch[];
  scorers: TopScorer[];
}) {
  const { route } = useRouter();
  const backHref = pathFor({ kind: 'section', comp: route.comp, section: 'schedule' });

  return (
    <AppProviders>
      <PlayerPage
        athleteId={athleteId}
        groups={groups}
        matches={matches}
        scorers={scorers}
        backHref={backHref}
      />
    </AppProviders>
  );
}
