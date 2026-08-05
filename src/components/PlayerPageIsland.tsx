import type { CompMatch, Group, TopScorer } from '../types';
import { pathFor } from '../utils/router';
import PlayerPage from './PlayerPage';

// Thin island wrapper. Passes schedule up-link + SSR-fetched data through to
// PlayerPage. client:only — none of the React hooks run server-side.
export default function PlayerPageIsland({
  comp,
  athleteId,
  groups,
  matches,
  scorers,
}: {
  comp: string;
  athleteId: string;
  groups: Group[];
  matches: CompMatch[];
  scorers: TopScorer[];
}) {
  const backHref = pathFor({ kind: 'section', comp, section: 'schedule' });

  return (
    <PlayerPage
      comp={comp}
      athleteId={athleteId}
      groups={groups}
      matches={matches}
      scorers={scorers}
      backHref={backHref}
    />
  );
}
