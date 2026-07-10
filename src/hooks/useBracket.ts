import { useMemo } from 'react';
import { type BracketMatch, type BracketSlot, ROUNDS, SEEDING } from '../data/bracketSeeding';
import type { CompMatch, WCGroup } from '../types';

// One resolved bracket cell. Either we have a real team (label + id)
// or a TBD placeholder (when the seed is not yet qualified, or the
// previous round's match is unplayed).
export interface ResolvedTeam {
  teamId: string;
  label: string; // display name (or place label if we know the seed only)
  flag: string; // team crest URL (from the standings feed); '' if unknown
}

export interface ResolvedBracketMatch {
  index: number;
  label: string;
  round: BracketMatch['round'];
  home: ResolvedTeam | null;
  away: ResolvedTeam | null;
  match: CompMatch | null; // populated when this round has a CompMatch with results
  winner: 'home' | 'away' | null;
}

// Top 8 best third-placed teams, by the same logic as StandingsView.
function bestThirdIds(groups: WCGroup[]): Set<string> {
  const thirds = groups.map((g) => g.standings[2]).filter(Boolean);
  thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  return new Set(thirds.slice(0, 8).map((tm) => tm.teamId));
}

// FIFA sends the 8 best third-placed teams into 8 fixed R32 slots. Each slot
// code (e.g. '3A/B/C/D/F') lists the groups eligible for that slot, and every
// qualifying group must fill exactly ONE slot. Resolving each slot
// independently (first eligible group) can put the same team in two matches,
// so we compute a global, unique assignment up front — greedy over the slots
// in FIFA's match order.
// ponytail: greedy uniqueness, not FIFA's full 495-row allocation table — it
// guarantees no third-place team appears twice; swap in the official table if
// exact slotting ever matters.
export function assignThirds(
  groups: WCGroup[],
  bestThirds: Set<string>,
): Map<string, ResolvedTeam> {
  const used = new Set<string>();
  const out = new Map<string, ResolvedTeam>();
  for (const bm of SEEDING) {
    if (bm.round !== 'R32' || bm.away.kind !== 'place') continue;
    const place = bm.away.place;
    const m3 = /^3([A-L](?:\/[A-L])*)$/.exec(place);
    if (!m3) continue;
    for (const letter of m3[1]!.split('/')) {
      if (used.has(letter)) continue;
      const row = groups.find((g) => g.name === letter)?.standings[2];
      if (row && bestThirds.has(row.teamId)) {
        out.set(place, { teamId: row.teamId, label: row.name, flag: row.flag });
        used.add(letter);
        break;
      }
    }
  }
  return out;
}

// Winner of a finished match. Prefers ESPN's winner flag (which resolves
// penalty shootouts where the regulation/ET score is level); falls back to
// the score. A level score with no recorded winner stays undetermined (null)
// rather than defaulting to the away side.
export function winnerOf(m: CompMatch): 'home' | 'away' | null {
  if (m.status !== 'finished' || m.homeScore == null || m.awayScore == null) return null;
  if (m.winner) return m.winner;
  if (m.homeScore > m.awayScore) return 'home';
  if (m.homeScore < m.awayScore) return 'away';
  return null;
}

// Resolve a fixed group-position place like '1A' or '2B' to a team.
// Returns null if the group isn't loaded yet (standings haven't
// arrived) or the position is empty.
function placeTeam(
  groups: WCGroup[],
  place: string,
  thirdAssign: Map<string, ResolvedTeam>,
): ResolvedTeam | null {
  const m = /^([12])([A-L])$/.exec(place);
  if (m) {
    const group = m[2]!;
    const pos = Number(m[1]) - 1;
    for (const g of groups) {
      if (g.name !== group) continue;
      const row = g.standings[pos];
      if (row) return { teamId: row.teamId, label: row.name, flag: row.flag };
    }
    return null;
  }
  // 3rd-place codes resolve through the global unique assignment.
  if (/^3[A-L]/.test(place)) return thirdAssign.get(place) ?? null;
  return null;
}

// Which resolved side won, by team IDENTITY rather than the real match's
// home/away flag — ESPN's home/away for a knockout tie need not match the
// bracket slot's home/away, so comparing sides by position would flip the
// winner. Compare stable ESPN team ids because display names can differ
// between the standings and scoreboard endpoints (for example USA vs United States).
function winnerSideById(
  m: CompMatch,
  home: ResolvedTeam | null,
  away: ResolvedTeam | null,
): 'home' | 'away' | null {
  const w = winnerOf(m);
  if (!w) return null;
  const winnerId = w === 'home' ? m.homeId : m.awayId;
  if (home && winnerId === home.teamId) return 'home';
  if (away && winnerId === away.teamId) return 'away';
  return null;
}

// Find the CompMatch for a 'winner' slot by looking up the CompMatch at
// the target stage and matching the two stable team ids against the
// resolved home/away teams from previous round matches.
function bracketMatchForStage(
  matches: CompMatch[],
  target: BracketMatch,
  home: ResolvedTeam | null,
  away: ResolvedTeam | null,
): CompMatch | null {
  const stage =
    target.round === '3rd' ? 'third' : (target.round.toLowerCase() as CompMatch['stage']);
  for (const m of matches) {
    if (m.stage !== stage) continue;
    if (home && (m.homeId === home.teamId || m.awayId === home.teamId)) {
      if (!away || m.homeId === away.teamId || m.awayId === away.teamId) {
        return m;
      }
    }
  }
  return null;
}

export function useBracket(groups: WCGroup[], matches: CompMatch[]) {
  return useMemo(() => {
    const bestThirds = bestThirdIds(groups);
    const thirdAssign = assignThirds(groups, bestThirds);
    const resolved: ResolvedBracketMatch[] = SEEDING.map((bm) => ({
      index: bm.index,
      label: bm.label,
      round: bm.round,
      home: null,
      away: null,
      match: null,
      winner: null,
    }));
    const byIndex = new Map(resolved.map((r) => [r.index, r]));

    // R32: every slot's HOME is a concrete group position (1X/2X), so resolve
    // it from standings, then find the real match that team is in and take the
    // ACTUAL opponent + winner straight off ESPN. The FIFA 3rd-place codes only
    // seed the away side before kickoff — once a match exists we never trust
    // the code (the greedy allocation and ESPN's real allocation can differ).
    for (const bm of SEEDING) {
      if (bm.round !== 'R32') continue;
      const r = byIndex.get(bm.index)!;
      r.home = bm.home.kind === 'place' ? placeTeam(groups, bm.home.place, thirdAssign) : null;
      r.away = bm.away.kind === 'place' ? placeTeam(groups, bm.away.place, thirdAssign) : null;
      if (!r.home) continue;
      const home = r.home;
      const real = matches.find(
        (m) => m.stage === 'r32' && (m.homeId === home.teamId || m.awayId === home.teamId),
      );
      if (!real) continue;
      r.match = real;
      r.away =
        real.homeId === home.teamId
          ? { teamId: real.awayId, label: real.awayName, flag: real.awayFlag }
          : { teamId: real.homeId, label: real.homeName, flag: real.homeFlag };
      r.winner = winnerSideById(real, r.home, r.away);
    }

    // R16 → Final, in seeding order (children always precede parents): each
    // side is the winner (or, for the 3rd-place match, the SF loser) of a prior
    // match. Attach the real match by the two resolved names; decide the winner
    // by identity so a flipped home/away can't invert it.
    for (const bm of SEEDING) {
      if (bm.round === 'R32') continue;
      const r = byIndex.get(bm.index)!;
      const resolveSlot = (slot: BracketSlot): ResolvedTeam | null => {
        if (slot.kind === 'place') return placeTeam(groups, slot.place, thirdAssign);
        const target = byIndex.get(slot.matchIndex);
        if (!target?.winner) return null;
        const won = target.winner === 'home' ? target.home : target.away;
        const lost = target.winner === 'home' ? target.away : target.home;
        return slot.kind === 'loser' ? lost : won;
      };
      r.home = resolveSlot(bm.home);
      r.away = resolveSlot(bm.away);
      r.match = bracketMatchForStage(matches, bm, r.home, r.away);
      if (r.match) r.winner = winnerSideById(r.match, r.home, r.away);
    }

    return {
      rounds: ROUNDS.map((round) => ({
        round,
        matches: resolved.filter((m) => m.round === round),
      })),
      resolved,
    };
  }, [groups, matches]);
}
