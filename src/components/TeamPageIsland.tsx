import type { TeamDetail } from '../types';
import { pathFor, useRouter } from '../utils/router';
import TeamPage from './TeamPage';

// Thin island wrapper. Derives the back-link to the team directory from the
// current route and renders the SSR-seeded team detail.
export default function TeamPageIsland({ team }: { team: TeamDetail }) {
  const { route } = useRouter();
  const backHref = pathFor({ kind: 'section', comp: route.comp, section: 'teams' });
  return <TeamPage team={team} backHref={backHref} />;
}
