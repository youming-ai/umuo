import { useCallback } from 'react';
import type { CompMatch, TopScorer, WCGroup } from '../types';
import { useRouter, navigate, pathFor } from '../utils/router';
import PlayerPage from './PlayerPage';
import AppProviders from './AppProviders';

// Thin island wrapper. Sets up onBack (navigate to /:comp matches) and
// passes all SSR-fetched data through to the existing PlayerPage. The
// island is client:only — none of the React hooks run server-side.
export default function PlayerPageIsland({
  athleteId,
  groups,
  matches,
  scorers,
}: {
  athleteId: string;
  groups: WCGroup[];
  matches: CompMatch[];
  scorers: TopScorer[];
}) {
  const { route } = useRouter();
  const onBack = useCallback(
    () =>
      navigate(pathFor({ kind: 'section', comp: route.comp, section: 'matches' }), {
        replace: true,
      }),
    [route.comp],
  );

  return (
    <AppProviders>
      <PlayerPage
        athleteId={athleteId}
        groups={groups}
        matches={matches}
        scorers={scorers}
        onBack={onBack}
      />
    </AppProviders>
  );
}
