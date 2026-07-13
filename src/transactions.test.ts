import { describe, expect, it } from 'vitest';
import { parseLeagueInjuries, parseTransactions } from './transactions';

describe('parseTransactions', () => {
  it('parses a valid transactions payload', () => {
    const json = {
      transactions: [
        { date: '2026-07-10', description: 'Signed G John Doe', team: { displayName: 'Hawks' } },
        { date: '2026-07-09', description: 'Waived F Jane Roe', team: { displayName: 'Celtics' } },
      ],
    };
    const result = parseTransactions(json);
    expect(result).toEqual([
      { date: '2026-07-10', description: 'Signed G John Doe', team: 'Hawks' },
      { date: '2026-07-09', description: 'Waived F Jane Roe', team: 'Celtics' },
    ]);
  });

  it('filters entries with empty description', () => {
    const json = {
      transactions: [
        { date: '2026-07-10', description: '', team: { displayName: 'Hawks' } },
        { date: '2026-07-10', description: 'Signed PG', team: { displayName: 'Hawks' } },
      ],
    };
    expect(parseTransactions(json)).toHaveLength(1);
  });

  it('returns [] for junk / missing feed', () => {
    expect(parseTransactions({})).toEqual([]);
    expect(parseTransactions(null)).toEqual([]);
    expect(parseTransactions('nope')).toEqual([]);
  });
});

describe('parseLeagueInjuries', () => {
  it('groups injuries by team', () => {
    const json = {
      injuries: [
        {
          displayName: 'Hawks',
          injuries: [
            { athlete: { displayName: 'Jock Landale' }, status: 'Day-To-Day' },
            { athlete: { displayName: 'Bogdan Bogdanovic' }, status: 'Out' },
          ],
        },
        {
          displayName: 'Celtics',
          injuries: [{ athlete: { displayName: 'Kristaps Porzingis' }, status: 'Out' }],
        },
      ],
    };
    const result = parseLeagueInjuries(json);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      team: 'Hawks',
      players: [
        { name: 'Jock Landale', status: 'Day-To-Day' },
        { name: 'Bogdan Bogdanovic', status: 'Out' },
      ],
    });
    expect(result[1]!.team).toBe('Celtics');
  });

  it('drops teams with no named players', () => {
    const json = {
      injuries: [
        {
          displayName: 'Empty',
          injuries: [{ athlete: {}, status: 'Out' }],
        },
      ],
    };
    expect(parseLeagueInjuries(json)).toEqual([]);
  });

  it('returns [] for junk', () => {
    expect(parseLeagueInjuries(undefined)).toEqual([]);
    expect(parseLeagueInjuries(42)).toEqual([]);
  });
});
