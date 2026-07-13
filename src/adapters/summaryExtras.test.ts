import { describe, expect, it } from 'vitest';
import { parseOdds, parseRecentForm } from './summaryExtras';

describe('parseOdds', () => {
  it('extracts the pickcenter line, spread, O/U and moneylines', () => {
    const odds = parseOdds({
      pickcenter: [
        {
          provider: { name: 'DraftKings' },
          details: 'MEX -230',
          spread: -1.5,
          overUnder: 2.5,
          homeTeamOdds: { moneyLine: -230 },
          awayTeamOdds: { moneyLine: 750 },
        },
      ],
    });
    expect(odds).toEqual({
      provider: 'DraftKings',
      details: 'MEX -230',
      spread: -1.5,
      overUnder: 2.5,
      homeMoneyLine: -230,
      awayMoneyLine: 750,
    });
  });

  it('returns null when neither provider nor details are present', () => {
    // a bare odds[] entry with numbers but no provider/details is not usable
    expect(parseOdds({ odds: [{ spread: -3 }] })).toBeNull();
    expect(parseOdds({})).toBeNull();
  });
});

describe('parseRecentForm', () => {
  it('maps lastFiveGames results to W/L/D letters and drops teams with no results', () => {
    const form = parseRecentForm({
      lastFiveGames: [
        {
          team: { id: '1', displayName: 'Mexico' },
          events: [{ gameResult: 'W' }, { gameResult: 'Draw' }, { gameResult: 'L' }],
        },
        { team: { id: '2', displayName: 'South Africa' }, events: [] },
      ],
    });
    expect(form).toEqual([{ teamId: '1', teamName: 'Mexico', results: ['W', 'D', 'L'] }]);
  });

  it('is defensive on missing/junk input', () => {
    expect(parseRecentForm({})).toEqual([]);
    expect(parseRecentForm({ lastFiveGames: 'nope' })).toEqual([]);
  });
});
