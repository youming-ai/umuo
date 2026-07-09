import type { CompMatch, TopScorer, WCGroup } from '../types';
import { useRouter, pathFor } from '../utils/router';
import TeamPage from './TeamPage';
import AppProviders from './AppProviders';

// Thin island wrapper. Passes schedule up-link + SSR-fetched data through to
// TeamPage. client:only — none of the React hooks run server-side.
export default function TeamPageIsland({
  teamId,
  groups,
  matches,
  scorers,
}: {
  teamId: string;
  groups: WCGroup[];
  matches: CompMatch[];
  scorers: TopScorer[];
}) {
  const { route } = useRouter();
  const backHref = pathFor({ kind: 'section', comp: route.comp, section: 'matches' });

  return (
    <AppProviders>
      <TeamPage
        teamId={teamId}
        groups={groups}
        matches={matches}
        scorers={scorers}
        backHref={backHref}
      />
    </AppProviders>
  );
}
