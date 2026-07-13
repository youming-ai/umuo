import type { LeagueInjuryGroup, TransactionItem } from '../types';
import AppProviders from './AppProviders';
import MovesView from './MovesView';

// Roster-moves island. Static (no fetch/poll) — renders SSR-seeded data.
export default function MovesIsland({
  transactions,
  injuries,
}: {
  transactions: TransactionItem[];
  injuries: LeagueInjuryGroup[];
}) {
  return (
    <AppProviders>
      <MovesView transactions={transactions} injuries={injuries} />
    </AppProviders>
  );
}
