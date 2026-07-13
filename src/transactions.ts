// Pure, defensive parse of ESPN's league transactions + injuries feeds.
// NBA-rich (year-round), soccer sparse/empty → graceful empty arrays. No
// DOM/React.
import type { LeagueInjuryGroup, TransactionItem } from './types';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown): Record<string, unknown> {
  return isObj(v) ? v : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

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
