import { describe, expect, it } from 'vitest';
import { basketballAdapter } from './basketball';

const scoreboard = {
  events: [
    {
      id: '401585',
      date: '2026-01-15T00:30Z',
      competitions: [
        {
          status: {
            period: 4,
            displayClock: '0.0',
            type: { state: 'post', shortDetail: 'Final' },
          },
          venue: { fullName: 'Crypto.com Arena', address: { city: 'Los Angeles' } },
          competitors: [
            {
              homeAway: 'home',
              score: '112',
              winner: true,
              team: { id: '13', displayName: 'Los Angeles Lakers', logo: 'lal.png' },
            },
            {
              homeAway: 'away',
              score: '108',
              winner: false,
              team: { id: '2', displayName: 'Boston Celtics', logo: 'bos.png' },
            },
          ],
        },
      ],
    },
    {
      id: '401586',
      date: '2026-01-16T00:00Z',
      competitions: [
        {
          status: { period: 0, type: { state: 'pre', shortDetail: '7:00 PM ET' } },
          venue: { fullName: 'Chase Center', address: { city: 'San Francisco' } },
          competitors: [
            {
              homeAway: 'home',
              score: '0',
              team: { id: '9', displayName: 'Golden State Warriors', logo: 'gsw.png' },
            },
            {
              homeAway: 'away',
              score: '0',
              team: { id: '25', displayName: 'Phoenix Suns', logo: 'phx.png' },
            },
          ],
        },
      ],
    },
  ],
};

const standings = {
  children: [
    {
      name: 'Eastern Conference',
      standings: {
        entries: [
          {
            team: { id: '2', displayName: 'Boston Celtics', logos: [{ href: 'bos.png' }] },
            stats: [
              { name: 'wins', value: 30, displayValue: '30' },
              { name: 'losses', value: 12, displayValue: '12' },
              { name: 'leagueWinPercent', value: 0.714, displayValue: '.714' },
              { name: 'gamesBehind', value: 0, displayValue: '-' },
            ],
          },
          {
            team: { id: '20', displayName: 'New York Knicks', logos: [{ href: 'nyk.png' }] },
            stats: [
              { name: 'wins', value: 27, displayValue: '27' },
              { name: 'losses', value: 15, displayValue: '15' },
              { name: 'leagueWinPercent', value: 0.643, displayValue: '.643' },
              { name: 'gamesBehind', value: 3, displayValue: '3' },
            ],
          },
        ],
      },
    },
    {
      name: 'Western Conference',
      standings: {
        entries: [
          {
            team: { id: '13', displayName: 'Los Angeles Lakers', logos: [{ href: 'lal.png' }] },
            stats: [
              { name: 'wins', value: 28, displayValue: '28' },
              { name: 'losses', value: 14, displayValue: '14' },
              { name: 'leagueWinPercent', value: 0.667, displayValue: '.667' },
              { name: 'gamesBehind', value: 0, displayValue: '-' },
            ],
          },
        ],
      },
    },
  ],
};

describe('basketballAdapter.transform', () => {
  it('normalizes scoreboard into matches with statusText and no stage/group', () => {
    const { matches } = basketballAdapter.transform(scoreboard, standings);
    expect(matches).toHaveLength(2);

    const finished = matches[0];
    expect(finished.status).toBe('finished');
    expect(finished.homeName).toBe('Los Angeles Lakers');
    expect(finished.homeScore).toBe(112);
    expect(finished.awayScore).toBe(108);
    expect(finished.homeFlag).toBe('lal.png');
    expect(finished.statusText).toBe('Final');
    expect(finished.winner).toBe('home');
    expect(finished.venue).toBe('Crypto.com Arena · Los Angeles');
    expect(finished.slug).toBe('los-angeles-lakers-vs-boston-celtics-401585');

    const upcoming = matches[1];
    expect(upcoming.status).toBe('upcoming');
    expect(upcoming.homeScore).toBeNull();
    expect(upcoming.statusText).toBe('7:00 PM ET');
  });

  it('builds Eastern/Western conference tables (W/L/PCT/GB), no scorers', () => {
    const { standings: sd, scorers } = basketballAdapter.transform(scoreboard, standings);
    expect(scorers).toEqual([]);
    expect(sd.kind).toBe('basketball');
    if (sd.kind !== 'basketball') throw new Error('expected basketball');
    expect(sd.conferences).toHaveLength(2);

    const east = sd.conferences[0];
    expect(east.name).toBe('Eastern Conference');
    expect(east.rows[0]).toEqual({
      teamId: '2',
      name: 'Boston Celtics',
      logo: 'bos.png',
      w: 30,
      l: 12,
      pct: '.714',
      gb: '-',
    });
    expect(east.rows[1].gb).toBe('3');

    const west = sd.conferences[1];
    expect(west.name).toBe('Western Conference');
    expect(west.rows[0].name).toBe('Los Angeles Lakers');
  });

  it('tolerates empty payloads without throwing', () => {
    const { matches, standings: sd, scorers } = basketballAdapter.transform({}, {});
    expect(matches).toEqual([]);
    expect(sd).toEqual({ kind: 'basketball', conferences: [] });
    expect(scorers).toEqual([]);
  });

  it('preserves numeric scores returned by ESPN', () => {
    const withNumericScores = structuredClone(scoreboard);
    withNumericScores.events[0].competitions[0].competitors[0].score = 112 as unknown as string;
    withNumericScores.events[0].competitions[0].competitors[1].score = 108 as unknown as string;

    const { matches } = basketballAdapter.transform(withNumericScores, standings);
    expect(matches[0].homeScore).toBe(112);
    expect(matches[0].awayScore).toBe(108);
  });
});

const summary = {
  header: {
    competitions: [
      {
        competitors: [
          { homeAway: 'home', team: { id: '13' } },
          { homeAway: 'away', team: { id: '2' } },
        ],
      },
    ],
  },
  boxscore: {
    teams: [
      {
        team: { id: '13' },
        statistics: [
          { label: 'FG', displayValue: '42-88' },
          { label: 'REB', displayValue: '45' },
        ],
      },
      {
        team: { id: '2' },
        statistics: [
          { label: 'FG', displayValue: '40-90' },
          { label: 'REB', displayValue: '41' },
        ],
      },
    ],
    players: [
      {
        team: { id: '13', displayName: 'Los Angeles Lakers' },
        statistics: [
          {
            labels: ['MIN', 'PTS', 'REB', 'AST'],
            athletes: [
              {
                starter: true,
                didNotPlay: false,
                athlete: { displayName: 'L. James' },
                stats: ['38', '30', '8', '11'],
              },
              {
                starter: false,
                didNotPlay: true,
                athlete: { displayName: 'B. Reserve' },
                stats: [],
              },
            ],
          },
        ],
      },
      {
        team: { id: '2', displayName: 'Boston Celtics' },
        statistics: [
          {
            labels: ['MIN', 'PTS', 'REB', 'AST'],
            athletes: [
              {
                starter: true,
                didNotPlay: false,
                athlete: { displayName: 'J. Tatum' },
                stats: ['40', '28', '9', '5'],
              },
            ],
          },
        ],
      },
    ],
  },
  gameInfo: {
    venue: { fullName: 'Crypto.com Arena', address: { city: 'Los Angeles' } },
    attendance: 18997,
  },
};

describe('basketballAdapter.transformSummary', () => {
  const d = basketballAdapter.transformSummary(summary);

  it('tags the detail as basketball', () => {
    expect(d.kind).toBe('basketball');
  });

  it('pairs team stats by label (home/away from competitor sides)', () => {
    if (d.kind !== 'basketball') throw new Error('expected basketball');
    expect(d.homeId).toBe('13');
    expect(d.awayId).toBe('2');
    expect(d.teamStats).toEqual([
      { label: 'FG', home: '42-88', away: '40-90' },
      { label: 'REB', home: '45', away: '41' },
    ]);
  });

  it('keeps a stat that is present only for the away team', () => {
    const awayOnly = structuredClone(summary);
    awayOnly.boxscore.teams[1].statistics.push({ label: 'BLK', displayValue: '6' });
    const parsed = basketballAdapter.transformSummary(awayOnly);
    if (parsed.kind !== 'basketball') throw new Error('expected basketball');
    expect(parsed.teamStats).toContainEqual({ label: 'BLK', home: '', away: '6' });
  });

  it('builds one boxscore table per team with labels + player rows (home first)', () => {
    if (d.kind !== 'basketball') throw new Error('expected basketball');
    expect(d.playerTables).toHaveLength(2);
    const home = d.playerTables[0];
    expect(home.teamId).toBe('13');
    expect(home.teamName).toBe('Los Angeles Lakers');
    expect(home.labels).toEqual(['MIN', 'PTS', 'REB', 'AST']);
    expect(home.players[0]).toEqual({
      name: 'L. James',
      starter: true,
      dnp: false,
      stats: ['38', '30', '8', '11'],
    });
    expect(home.players[1]).toEqual({ name: 'B. Reserve', starter: false, dnp: true, stats: [] });
    expect(d.playerTables[1].teamId).toBe('2');
  });

  it('reads venue and attendance', () => {
    if (d.kind !== 'basketball') throw new Error('expected basketball');
    expect(d.venue).toBe('Crypto.com Arena · Los Angeles');
    expect(d.attendance).toBe(18997);
  });

  it('orders boxscore tables [home, away] even when players arrive away-first', () => {
    const awayFirst = {
      ...summary,
      boxscore: { ...summary.boxscore, players: [...summary.boxscore.players].reverse() },
    };
    const parsed = basketballAdapter.transformSummary(awayFirst);
    if (parsed.kind !== 'basketball') throw new Error('expected basketball');
    expect(parsed.playerTables[0].teamId).toBe(parsed.homeId);
    expect(parsed.playerTables[1].teamId).toBe(parsed.awayId);
  });

  it('tolerates an empty object without throwing', () => {
    const empty = basketballAdapter.transformSummary({});
    if (empty.kind !== 'basketball') throw new Error('expected basketball');
    expect(empty.teamStats).toEqual([]);
    expect(empty.playerTables).toEqual([]);
    expect(empty.attendance).toBeNull();
  });
});
