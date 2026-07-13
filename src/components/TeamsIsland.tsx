import type { TeamSummary } from '../types';
import AppProviders from './AppProviders';
import TeamsView from './TeamsView';

// Team directory island. Static (no fetch/poll) — just renders the SSR-seeded
// team list; the theme provider keeps parity with the other islands.
export default function TeamsIsland({ comp, teams }: { comp: string; teams: TeamSummary[] }) {
  return (
    <AppProviders>
      <TeamsView comp={comp} teams={teams} />
    </AppProviders>
  );
}
