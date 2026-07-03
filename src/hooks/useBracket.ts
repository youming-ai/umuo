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

// Match the SEEDING R32 row to a real CompMatch by team group. Each
// r32 CompMatch in our data has a home team with `group` set to the
// home team's group letter; the away team's group letter isn't on
// CompMatch today, so we match by (homeGroup, awayGroup) from the
// SEEDING place codes.
function r32MatchFor(
  groups: WCGroup[],
  matches: CompMatch[],
  seeding: BracketMatch,
): CompMatch | null {
  if (seeding.round !== 'R32') return null;
  if (seeding.home.kind !== 'place' || seeding.away.kind !== 'place') return null;
  // The home side is a single-group position like '1A' or '2A'.
  // The away side is either a single position (1X/2X) or a 3rd-place
  // group list. For 3rd-place matches, the away group letter is the
  // first letter in the slash list (FIFA's official ordering is the
  // order of the actual groups).
  const homeGroup = (seeding.home.place.match(/^[12]([A-L])$/) ?? [])[1];
  const awayGroup =
    (seeding.away.place.match(/^[12]([A-L])$/) ?? [])[1] ??
    (seeding.away.place.match(/^3([A-L])\//) ?? [])[1];
  if (!homeGroup || !awayGroup) return null;
  for (const m of matches) {
    if (m.stage !== 'r32') continue;
    if (m.group !== homeGroup) continue;
    // The away team's group letter isn't on CompMatch. Look up the away
    // team by name match in any group matching the expected away group.
    for (const g of groups) {
      if (g.name !== awayGroup) continue;
      for (const s of g.standings) {
        if (s.name === m.awayName) return m;
      }
    }
  }
  return null;
}

// Find the CompMatch for a 'winner' slot by looking up the CompMatch at
// the target stage and matching the two team names against the
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
    if (home && (m.homeName === home.label || m.awayName === home.label)) {
      if (!away || m.homeName === away.label || m.awayName === away.label) {
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
    // Pre-resolve: build a Map<matchIndex, ResolvedTeam> for the R32
    // round first, so that R16+ can look up winners by index.
    const resolved: ResolvedBracketMatch[] = SEEDING.map((bm) => {
      const resolveOne = (slot: BracketSlot): ResolvedTeam | null => {
        if (slot.kind === 'place') return placeTeam(groups, slot.place, thirdAssign);
        return null; // 'winner'/'loser' resolved below after results are known
      };
      return {
        index: bm.index,
        label: bm.label,
        round: bm.round,
        home: resolveOne(bm.home),
        away: resolveOne(bm.away),
        match: null,
        winner: null,
      };
    });

    // For R32: also try to attach the actual CompMatch. The hook iterates
    // rounds, so we can resolve winner slots progressively. But the
    // simplest approach: do a second pass to attach matches + winners.
    for (let i = 0; i < resolved.length; i++) {
      const bm = SEEDING[i]!;
      const r = resolved[i]!;
      // Attach the actual CompMatch when one exists.
      if (bm.round === 'R32') {
        r.match = r32MatchFor(groups, matches, bm);
      } else {
        // R16 / QF / SF / 3rd / Final: look up by stage + team names.
        r.match = bracketMatchForStage(matches, bm, r.home, r.away);
      }
      // Determine the winner if the CompMatch has been played.
      if (r.match) r.winner = winnerOf(r.match);
    }

    // Now resolve R16+ winner slots. For each non-R32 row, walk the
    // winner indices and pull the resolved team from the prior match.
    // Re-resolve after R32 results are known.
    for (let i = 0; i < resolved.length; i++) {
      const bm = SEEDING[i]!;
      const r = resolved[i]!;
      const resolveWinner = (slot: BracketSlot): ResolvedTeam | null => {
        if (slot.kind === 'place') return placeTeam(groups, slot.place, thirdAssign);
        const target = resolved[slot.matchIndex];
        if (!target) return null;
        if (slot.kind === 'loser') {
          // The third-place match takes the two semifinal LOSERS.
          if (target.winner === 'home') return target.away;
          if (target.winner === 'away') return target.home;
          return null;
        }
        if (target.winner === 'home') return target.home;
        if (target.winner === 'away') return target.away;
        return null;
      };
      r.home = resolveWinner(bm.home);
      r.away = resolveWinner(bm.away);
      // Re-attach the CompMatch (now that we have team names resolved
      // from previous rounds, the lookup can succeed even when the
      // r32 winner wasn't a 'place' seed).
      if (bm.round === 'R32') {
        r.match = r32MatchFor(groups, matches, bm);
      } else {
        r.match = bracketMatchForStage(matches, bm, r.home, r.away);
      }
      if (r.match) r.winner = winnerOf(r.match);
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
