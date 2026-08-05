import type { TeamDetail } from '../types';
import { pathFor } from '../utils/router';
import TeamPage from './TeamPage';

// Thin island wrapper. Builds the back-link to the team directory and renders
// the SSR-seeded team detail. `comp` comes from the page, not the URL — the
// island renders on the server too, where there is no window.location.
export default function TeamPageIsland({ team, comp }: { team: TeamDetail; comp: string }) {
  const backHref = pathFor({ kind: 'section', comp, section: 'teams' });
  return <TeamPage team={team} backHref={backHref} />;
}
