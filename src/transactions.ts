// Pure, defensive parse of ESPN's league transactions + injuries feeds.
// NBA-rich (year-round), soccer sparse/empty → graceful empty arrays. No
// DOM/React.
import type { LeagueInjuryGroup, TransactionItem } from './types';
import { arr, obj, str } from './utils/coerce';

export function parseTransactions(json: unknown): TransactionItem[] {
  return arr(obj(json).transactions)
    .map(obj)
    .map(
      (t): TransactionItem => ({
        date: str(t.date),
        description: str(t.description),
        team: str(obj(t.team).displayName),
      }),
    )
    .filter((t) => t.description);
}

// League injuries feed → one group per team ({ displayName, injuries[] }).
export function parseLeagueInjuries(json: unknown): LeagueInjuryGroup[] {
  return arr(obj(json).injuries)
    .map(obj)
    .map(
      (g): LeagueInjuryGroup => ({
        team: str(g.displayName),
        players: arr(g.injuries)
          .map(obj)
          .map((i) => ({ name: str(obj(i.athlete).displayName), status: str(i.status) }))
          .filter((p) => p.name),
      }),
    )
    .filter((g) => g.players.length > 0);
}
