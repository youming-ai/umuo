import { describe, expect, it } from 'vitest';
import { ROUNDS, SEEDING } from './bracketSeeding';

describe('SEEDING', () => {
  it('has exactly 30 knockout matches: 16 R32 + 8 R16 + 4 QF + 2 SF + 1 3rd + 1 Final', () => {
    const counts = SEEDING.reduce<Record<string, number>>((acc, m) => {
      acc[m.round] = (acc[m.round] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ R32: 16, R16: 8, QF: 4, SF: 2, '3rd': 1, Final: 1 });
  });

  it('uses the official FIFA Match 73–104 labels in order', () => {
    expect(SEEDING.map((m) => m.label)).toEqual([
      ...Array.from({ length: 16 }, (_, i) => `M${73 + i}`),
      ...Array.from({ length: 8 }, (_, i) => `M${89 + i}`),
      ...Array.from({ length: 4 }, (_, i) => `M${97 + i}`),
      ...Array.from({ length: 2 }, (_, i) => `M${101 + i}`),
      'M103',
      'M104',
    ]);
  });

  it('opens with the documented R32 pairings: M73 = 2A vs 2B', () => {
    const m73 = SEEDING[0];
    expect(m73?.round).toBe('R32');
    expect(m73?.home).toEqual({ kind: 'place', place: '2A' });
    expect(m73?.away).toEqual({ kind: 'place', place: '2B' });
  });

  it('R16 winner slots reference the correct R32 indices', () => {
    // Per FIFA's fixed 2026 bracket: M89 = winner M74 vs winner M77 (indices
    // 1, 4) and M92 = winner M79 vs winner M80 (indices 6, 7).
    const m89 = SEEDING[16];
    expect(m89?.home).toEqual({ kind: 'winner', matchIndex: 1 });
    expect(m89?.away).toEqual({ kind: 'winner', matchIndex: 4 });
    const m92 = SEEDING[19];
    expect(m92?.home).toEqual({ kind: 'winner', matchIndex: 6 });
    expect(m92?.away).toEqual({ kind: 'winner', matchIndex: 7 });
  });

  it('Final takes the SF winners; 3rd place takes the SF losers (28, 29)', () => {
    const final = SEEDING.find((m) => m.round === 'Final')!;
    const third = SEEDING.find((m) => m.round === '3rd')!;
    expect(final.home).toEqual({ kind: 'winner', matchIndex: 28 });
    expect(final.away).toEqual({ kind: 'winner', matchIndex: 29 });
    expect(third.home).toEqual({ kind: 'loser', matchIndex: 28 });
    expect(third.away).toEqual({ kind: 'loser', matchIndex: 29 });
  });

  it('exposes the ROUNDS array in display order', () => {
    expect(ROUNDS).toEqual(['R32', 'R16', 'QF', 'SF', '3rd', 'Final']);
  });
});
