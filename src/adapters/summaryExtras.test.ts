import { describe, expect, it } from 'vitest';
import { parseOdds, parseRecentForm, parseScoreboardOdds } from './summaryExtras';

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
      drawMoneyLine: null,
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

describe('parseScoreboardOdds', () => {
  it('maps a soccer 3-way scoreboard odds block, parsing string prices', () => {
    const odds = parseScoreboardOdds([
      {
        provider: { name: 'DraftKings' },
        details: 'FRA +140',
        overUnder: 2.5,
        pointSpread: { home: { close: { line: '-0.5' } } },
        moneyline: { home: { close: { odds: '+140' } }, away: { close: { odds: '+195' } } },
        drawOdds: { moneyLine: 215 },
      },
    ]);
    expect(odds).toEqual({
      provider: 'DraftKings',
      details: 'FRA +140',
      spread: -0.5,
      overUnder: 2.5,
      homeMoneyLine: 140,
      awayMoneyLine: 195,
      drawMoneyLine: 215,
    });
  });

  it('parses a 2-way block with no draw price (drawMoneyLine null)', () => {
    const odds = parseScoreboardOdds([
      {
        provider: { name: 'ESPN BET' },
        details: 'LAL -6',
        overUnder: 220.5,
        pointSpread: { home: { close: { line: '-6.5' } } },
        moneyline: { home: { close: { odds: '-250' } }, away: { close: { odds: '+200' } } },
      },
    ]);
    expect(odds).toEqual({
      provider: 'ESPN BET',
      details: 'LAL -6',
      spread: -6.5,
      overUnder: 220.5,
      homeMoneyLine: -250,
      awayMoneyLine: 200,
      drawMoneyLine: null,
    });
  });

  it('returns null with no provider/details, and is defensive on junk', () => {
    expect(parseScoreboardOdds([{ overUnder: 2.5 }])).toBeNull();
    expect(parseScoreboardOdds([])).toBeNull();
    expect(parseScoreboardOdds('nope')).toBeNull();
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
