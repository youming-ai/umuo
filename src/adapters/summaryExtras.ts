import type { MatchOdds } from '../types';

// Shared parsers for the "extras" blocks of an ESPN summary payload — betting
// odds (pickcenter) and each team's recent form (lastFiveGames). Both sport
// adapters' transformSummary reuse these. Own defensive coercion (obj/arr/str/
// num) so a shape drift degrades to null/[] instead of throwing.
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
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
// Scoreboard odds encode prices as strings ("+140", "-0.5"); parse to a finite
// number or null. parseInt/parseFloat both handle a leading '+'.
function numStr(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export type FormResult = 'W' | 'L' | 'D';
export interface TeamForm {
  teamId: string;
  teamName: string;
  results: FormResult[]; // from lastFiveGames, ESPN order (most recent first)
}

// Betting line from pickcenter[0] (falls back to odds[0]). null when neither a
// provider nor a details string is present.
export function parseOdds(summary: Record<string, unknown>): MatchOdds | null {
  const pc = obj(arr(summary.pickcenter)[0] ?? arr(summary.odds)[0]);
  const provider = str(obj(pc.provider).name);
  const details = str(pc.details);
  if (!provider && !details) return null;
  return {
    provider,
    details,
    spread: num(pc.spread),
    overUnder: num(pc.overUnder),
    homeMoneyLine: num(obj(pc.homeTeamOdds).moneyLine),
    awayMoneyLine: num(obj(pc.awayTeamOdds).moneyLine),
  };
}

// Odds off a scoreboard event's competition.odds[0]. That block differs from the
// summary pickcenter: moneylines live under moneyline.{home,away}.close.odds as
// strings ("+140"), the spread under pointSpread.home.close.line, the total
// under a top-level overUnder, and soccer's draw price under drawOdds.moneyLine.
// Maps to the shared MatchOdds so the Odds tab reuses one type. null when no
// provider/details present (feed omits odds for many fixtures).
export function parseScoreboardOdds(oddsList: unknown): MatchOdds | null {
  const o = obj(arr(oddsList)[0]);
  const provider = str(obj(o.provider).name);
  const details = str(o.details);
  if (!provider && !details) return null;
  const ml = obj(o.moneyline);
  return {
    provider,
    details,
    spread: numStr(obj(obj(obj(o.pointSpread).home).close).line),
    overUnder: num(o.overUnder),
    homeMoneyLine: numStr(obj(obj(ml.home).close).odds),
    awayMoneyLine: numStr(obj(obj(ml.away).close).odds),
    drawMoneyLine: num(obj(o.drawOdds).moneyLine),
  };
}

// Each team's recent results from lastFiveGames. `gameResult` may be a letter
// ("W") or a word ("Win"/"Loss"/"Draw"); the first character covers both.
export function parseRecentForm(summary: Record<string, unknown>): TeamForm[] {
  return arr(summary.lastFiveGames)
    .map(obj)
    .map((entry): TeamForm => {
      const team = obj(entry.team);
      const results = arr(entry.events)
        .map(obj)
        .map((e) => str(e.gameResult).trim().toUpperCase().charAt(0))
        .filter((c): c is FormResult => c === 'W' || c === 'L' || c === 'D');
      return { teamId: str(team.id), teamName: str(team.displayName), results };
    })
    .filter((f) => f.results.length > 0);
}
