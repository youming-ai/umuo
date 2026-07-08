import { useCallback } from 'react';
import type { CompMatch, TopScorer, WCGroup } from '../types';
import { useRouter, navigate, pathFor } from '../utils/router';
import PlayerPage from './PlayerPage';

// Thin island wrapper. Sets up onBack (navigate to /:comp matches) and
// passes all SSR-fetched data through to the existing PlayerPage. The
// island is client:only — none of the React hooks run server-side.
// The comp comes from useRouter (the URL path for /player/:id has no
// comp prefix; useRouter resolves it from window.location, which falls
// back to the default competition via parseRoute's legacy-path logic).
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
    <PlayerPage
      athleteId={athleteId}
      groups={groups}
      matches={matches}
      scorers={scorers}
      onBack={onBack}
    />
  );
}
