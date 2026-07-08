// WC2026 knockout bracket — fixed FIFA-official pairings for the 48-team
// format. We hardcode the slot structure because ESPN does NOT expose
// bracket linking (no parentMatchId / bracketId fields), and the
// pairing rules are the same for every World Cup edition. The hook
// (src/hooks/useBracket.ts) attaches live CompMatch results onto each
// SEEDING row at render time.

export type BracketSlot =
  | { kind: 'place'; place: string }
  | { kind: 'winner'; matchIndex: number }
  | { kind: 'loser'; matchIndex: number };

export interface BracketMatch {
  // Index in the SEEDING array. Stable across renders.
  index: number;
  // Short label per FIFA's official numbering: M73, M74, …, M104.
  // Displayed in the bracket cell.
  label: string;
  round: 'R32' | 'R16' | 'QF' | 'SF' | '3rd' | 'Final';
  home: BracketSlot;
  away: BracketSlot;
}

// 30 knockout matches: 16 R32 + 8 R16 + 4 QF + 2 SF + 1 third-place
// + 1 Final. The 16 R32 entries are FIFA M73–M88 verbatim, the
// remaining pairings are derived from the official bracket chart.
export const SEEDING: BracketMatch[] = [
  // R32 (M73–M88)
  {
    index: 0,
    label: 'M73',
    round: 'R32',
    home: { kind: 'place', place: '2A' },
    away: { kind: 'place', place: '2B' },
  },
  {
    index: 1,
    label: 'M74',
    round: 'R32',
    home: { kind: 'place', place: '1E' },
    away: { kind: 'place', place: '3A/B/C/D/F' },
  },
  {
    index: 2,
    label: 'M75',
    round: 'R32',
    home: { kind: 'place', place: '1F' },
    away: { kind: 'place', place: '2C' },
  },
  {
    index: 3,
    label: 'M76',
    round: 'R32',
    home: { kind: 'place', place: '1C' },
    away: { kind: 'place', place: '2F' },
  },
  {
    index: 4,
    label: 'M77',
    round: 'R32',
    home: { kind: 'place', place: '1I' },
    away: { kind: 'place', place: '3C/D/F/G/H' },
  },
  {
    index: 5,
    label: 'M78',
    round: 'R32',
    home: { kind: 'place', place: '2E' },
    away: { kind: 'place', place: '2I' },
  },
  {
    index: 6,
    label: 'M79',
    round: 'R32',
    home: { kind: 'place', place: '1A' },
    away: { kind: 'place', place: '3C/E/F/H/I' },
  },
  {
    index: 7,
    label: 'M80',
    round: 'R32',
    home: { kind: 'place', place: '1L' },
    away: { kind: 'place', place: '3E/H/I/J/K' },
  },
  {
    index: 8,
    label: 'M81',
    round: 'R32',
    home: { kind: 'place', place: '1D' },
    away: { kind: 'place', place: '3B/E/F/I/J' },
  },
  {
    index: 9,
    label: 'M82',
    round: 'R32',
    home: { kind: 'place', place: '1G' },
    away: { kind: 'place', place: '3A/E/H/I/J' },
  },
  {
    index: 10,
    label: 'M83',
    round: 'R32',
    home: { kind: 'place', place: '2K' },
    away: { kind: 'place', place: '2L' },
  },
  {
    index: 11,
    label: 'M84',
    round: 'R32',
    home: { kind: 'place', place: '1H' },
    away: { kind: 'place', place: '2J' },
  },
  {
    index: 12,
    label: 'M85',
    round: 'R32',
    home: { kind: 'place', place: '1B' },
    away: { kind: 'place', place: '3E/F/G/I/J' },
  },
  {
    index: 13,
    label: 'M86',
    round: 'R32',
    home: { kind: 'place', place: '1J' },
    away: { kind: 'place', place: '2H' },
  },
  {
    index: 14,
    label: 'M87',
    round: 'R32',
    home: { kind: 'place', place: '1K' },
    away: { kind: 'place', place: '3D/E/I/J/L' },
  },
  {
    index: 15,
    label: 'M88',
    round: 'R32',
    home: { kind: 'place', place: '2D' },
    away: { kind: 'place', place: '2G' },
  },

  // R16 (M89–M96): 'winner' refers to R32 match index
  {
    index: 16,
    label: 'M89',
    round: 'R16',
    home: { kind: 'winner', matchIndex: 1 },
    away: { kind: 'winner', matchIndex: 4 },
  },
  {
    index: 17,
    label: 'M90',
    round: 'R16',
    home: { kind: 'winner', matchIndex: 0 },
    away: { kind: 'winner', matchIndex: 2 },
  },
  {
    index: 18,
    label: 'M91',
    round: 'R16',
    home: { kind: 'winner', matchIndex: 3 },
    away: { kind: 'winner', matchIndex: 5 },
  },
  {
    index: 19,
    label: 'M92',
    round: 'R16',
    home: { kind: 'winner', matchIndex: 6 },
    away: { kind: 'winner', matchIndex: 7 },
  },
  {
    index: 20,
    label: 'M93',
    round: 'R16',
    home: { kind: 'winner', matchIndex: 10 },
    away: { kind: 'winner', matchIndex: 11 },
  },
  {
    index: 21,
    label: 'M94',
    round: 'R16',
    home: { kind: 'winner', matchIndex: 8 },
    away: { kind: 'winner', matchIndex: 9 },
  },
  {
    index: 22,
    label: 'M95',
    round: 'R16',
    home: { kind: 'winner', matchIndex: 13 },
    away: { kind: 'winner', matchIndex: 15 },
  },
  {
    index: 23,
    label: 'M96',
    round: 'R16',
    home: { kind: 'winner', matchIndex: 12 },
    away: { kind: 'winner', matchIndex: 14 },
  },

  // QF (M97–M100)
  {
    index: 24,
    label: 'M97',
    round: 'QF',
    home: { kind: 'winner', matchIndex: 16 },
    away: { kind: 'winner', matchIndex: 17 },
  },
  {
    index: 25,
    label: 'M98',
    round: 'QF',
    home: { kind: 'winner', matchIndex: 20 },
    away: { kind: 'winner', matchIndex: 21 },
  },
  {
    index: 26,
    label: 'M99',
    round: 'QF',
    home: { kind: 'winner', matchIndex: 18 },
    away: { kind: 'winner', matchIndex: 19 },
  },
  {
    index: 27,
    label: 'M100',
    round: 'QF',
    home: { kind: 'winner', matchIndex: 22 },
    away: { kind: 'winner', matchIndex: 23 },
  },

  // SF (M101–M102)
  {
    index: 28,
    label: 'M101',
    round: 'SF',
    home: { kind: 'winner', matchIndex: 24 },
    away: { kind: 'winner', matchIndex: 25 },
  },
  {
    index: 29,
    label: 'M102',
    round: 'SF',
    home: { kind: 'winner', matchIndex: 26 },
    away: { kind: 'winner', matchIndex: 27 },
  },

  // Third-place playoff (M103): the two SEMIFINAL LOSERS, not the winners.
  {
    index: 30,
    label: 'M103',
    round: '3rd',
    home: { kind: 'loser', matchIndex: 28 },
    away: { kind: 'loser', matchIndex: 29 },
  },

  // Final (M104)
  {
    index: 31,
    label: 'M104',
    round: 'Final',
    home: { kind: 'winner', matchIndex: 28 },
    away: { kind: 'winner', matchIndex: 29 },
  },
];

// Round labels (in display order) and the slice of SEEDING that
// belongs to each round.
export const ROUNDS: Array<BracketMatch['round']> = ['R32', 'R16', 'QF', 'SF', '3rd', 'Final'];

export function sliceByRound(round: BracketMatch['round']): BracketMatch[] {
  return SEEDING.filter((m) => m.round === round);
}
