import type { Leaderboard } from '../leaders';
import AppProviders from './AppProviders';
import StatsView from './StatsView';

// Stats page island. Leaderboards change slowly and need no interactivity, so
// this just renders the SSR-seeded boards (no client fetch/poll).
export default function StatsIsland({ boards }: { boards: Leaderboard[] }) {
  return (
    <AppProviders>
      <StatsView boards={boards} />
    </AppProviders>
  );
}
