import { describe, expect, it } from 'vitest';
import { soccerAdapter } from './soccer';

// --- minimal ESPN scoreboard + standings shapes (lifted from useWorldCup.test) ---
const scoreboard = {
  events: [
    {
      id: '760420',
      date: '2026-06-13T19:00Z',
      season: { slug: 'group-stage' },
      competitions: [
        {
          status: { type: { state: 'post' } },
          venue: { fullName: "Levi's Stadium", address: { city: 'Santa Clara, California' } },
          competitors: [
            {
              homeAway: 'home',
              score: '2',
              team: { id: '1', displayName: 'Mexico', logo: 'mex.png' },
            },
            {
              homeAway: 'away',
              score: '0',
              team: { id: '2', displayName: 'South Africa', logo: 'rsa.png' },
            },
          ],
          details: [
            {
              scoringPlay: true,
              clock: { displayValue: "22'" },
              type: { text: 'Goal' },
              team: { id: '1' },
              athletesInvolved: [{ id: '4577', displayName: 'H. Lozano' }],
            },
            {
              scoringPlay: true,
              clock: { displayValue: "80'" },
              type: { text: 'Penalty - Scored' },
              team: { id: '1' },
              athletesInvolved: [{ id: '4579', displayName: 'R. Jiménez' }],
            },
            { scoringPlay: false, type: { text: 'Yellow Card' }, team: { id: '2' } },
          ],
        },
      ],
    },
    {
      id: '760900',
      date: '2026-07-04T16:00Z',
      season: { slug: 'round-of-16' },
      competitions: [
        {
          status: { type: { state: 'pre' } },
          venue: { fullName: 'MetLife Stadium', address: { city: 'East Rutherford' } },
          competitors: [
            {
              homeAway: 'home',
              score: '0',
              team: { id: '9', displayName: 'Brazil', logos: [{ href: 'bra.png' }] },
            },
            {
              homeAway: 'away',
              score: '0',
              team: { id: '12', displayName: 'Scotland', logos: [{ href: 'sco.png' }] },
            },
          ],
          details: [],
        },
      ],
    },
  ],
};

const standings = {
  children: [
    {
      name: 'Group A',
      standings: {
        entries: [
          {
            team: { id: '1', displayName: 'Mexico', logos: [{ href: 'mex.png' }] },
            stats: [
              { name: 'gamesPlayed', value: 1 },
              { name: 'wins', value: 1 },
              { name: 'ties', value: 0 },
              { name: 'losses', value: 0 },
              { name: 'pointsFor', value: 2 },
              { name: 'pointsAgainst', value: 0 },
              { name: 'pointDifferential', value: 2 },
              { name: 'points', value: 3 },
            ],
          },
          {
            team: { id: '2', displayName: 'South Africa', logos: [{ href: 'rsa.png' }] },
            stats: [
              { name: 'gamesPlayed', value: 1 },
              { name: 'wins', value: 0 },
              { name: 'ties', value: 0 },
              { name: 'losses', value: 1 },
              { name: 'pointsFor', value: 0 },
              { name: 'pointsAgainst', value: 2 },
              { name: 'pointDifferential', value: -2 },
              { name: 'points', value: 0 },
            ],
          },
        ],
      },
    },
  ],
};

describe('soccerAdapter.transform', () => {
  it('normalizes ESPN scoreboard + standings into matches/standings/scorers', () => {
    const { matches, standings: sd, scorers } = soccerAdapter.transform(scoreboard, standings);
    expect(matches).toHaveLength(2);

    const finished = matches[0];
    expect(finished.status).toBe('finished');
    expect(finished.homeScore).toBe(2);
    expect(finished.homeFlag).toBe('mex.png');
    expect(finished.homeScorers).toEqual([
      { playerId: '4577', name: 'H. Lozano', minute: "22'", tag: '' },
      { playerId: '4579', name: 'R. Jiménez', minute: "80'", tag: ' (p)' },
    ]);
    expect(finished.awayScorers).toEqual([]);
    expect(finished.venue).toBe("Levi's Stadium · Santa Clara, California");
    expect(finished.kickoff?.toISOString()).toBe('2026-06-13T19:00:00.000Z');

    const upcoming = matches[1];
    expect(upcoming.status).toBe('upcoming');
    expect(upcoming.homeScore).toBeNull();
    expect(upcoming.homeFlag).toBe('bra.png');

    expect(sd.kind).toBe('soccer');
    if (sd.kind !== 'soccer') throw new Error('expected soccer');
    const groupA = sd.groups[0];
    expect(groupA.name).toBe('A');
    expect(groupA.standings[0].name).toBe('Mexico');
    expect(groupA.standings[0].pts).toBe(3);
    expect(groupA.standings[0].gd).toBe(2);

    // Every scoring play ranks — both Mexico goals, penalty included, sorted
    // by goals then name. (The old leaders-based source only kept one per team.)
    expect(scorers).toEqual([
      {
        athleteId: '4577',
        name: 'H. Lozano',
        teamId: '1',
        teamName: 'Mexico',
        teamFlag: 'mex.png',
        goals: 1,
      },
      {
        athleteId: '4579',
        name: 'R. Jiménez',
        teamId: '1',
        teamName: 'Mexico',
        teamFlag: 'mex.png',
        goals: 1,
      },
    ]);
  });

  it('tallies goals per player across the tournament and excludes own goals', () => {
    const sb = {
      events: [
        {
          id: 'e1',
          date: '2026-06-13T19:00Z',
          season: { slug: 'group-stage' },
          competitions: [
            {
              status: { type: { state: 'post' } },
              competitors: [
                {
                  homeAway: 'home',
                  score: '2',
                  team: { id: '1', displayName: 'A', logo: 'a.png' },
                },
                {
                  homeAway: 'away',
                  score: '1',
                  team: { id: '2', displayName: 'B', logo: 'b.png' },
                },
              ],
              details: [
                {
                  scoringPlay: true,
                  clock: { displayValue: "10'" },
                  type: { text: 'Goal' },
                  team: { id: '1' },
                  athletesInvolved: [{ id: 'x', displayName: 'Player X' }],
                },
                {
                  scoringPlay: true,
                  clock: { displayValue: "50'" },
                  type: { text: 'Goal' },
                  team: { id: '1' },
                  athletesInvolved: [{ id: 'x', displayName: 'Player X' }],
                },
                {
                  scoringPlay: true,
                  clock: { displayValue: "70'" },
                  type: { text: 'Own Goal' },
                  team: { id: '1' },
                  athletesInvolved: [{ id: 'y', displayName: 'Player Y' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const { scorers } = soccerAdapter.transform(sb, {});
    // Player X's two goals sum to 2; the own goal never puts Player Y on the board.
    expect(scorers).toEqual([
      { athleteId: 'x', name: 'Player X', teamId: '1', teamName: 'A', teamFlag: 'a.png', goals: 2 },
    ]);
  });

  it('captures penalty-shootout score and finishType for a pens match', () => {
    const pens = {
      events: [
        {
          id: '760489',
          date: '2026-07-05T16:00Z',
          season: { slug: 'round-of-16' },
          competitions: [
            {
              status: {
                period: 5,
                displayClock: "120'",
                type: { state: 'post', name: 'STATUS_FINAL_PEN' },
              },
              venue: { fullName: 'X', address: { city: 'Y' } },
              competitors: [
                {
                  homeAway: 'home',
                  score: '1',
                  winner: false,
                  shootoutScore: 3,
                  team: { id: '1', displayName: 'Germany', logo: 'ger.png' },
                },
                {
                  homeAway: 'away',
                  score: '1',
                  winner: true,
                  shootoutScore: 4,
                  team: { id: '2', displayName: 'Paraguay', logo: 'par.png' },
                },
              ],
              details: [],
            },
          ],
        },
      ],
    };
    const { matches } = soccerAdapter.transform(pens, {});
    const m = matches[0];
    expect(m.finishType).toBe('pens');
    expect(m.homeShootoutScore).toBe(3);
    expect(m.awayShootoutScore).toBe(4);
    expect(m.winner).toBe('away');
  });

  it('marks an extra-time decider as aet with no shootout score', () => {
    const aet = {
      events: [
        {
          id: '760490',
          date: '2026-07-05T20:00Z',
          season: { slug: 'quarterfinals' },
          competitions: [
            {
              status: {
                period: 4,
                displayClock: "120'",
                type: { state: 'post', name: 'STATUS_FINAL_AET' },
              },
              venue: { fullName: 'X', address: { city: 'Y' } },
              competitors: [
                {
                  homeAway: 'home',
                  score: '2',
                  winner: true,
                  team: { id: '1', displayName: 'Spain', logo: 's.png' },
                },
                {
                  homeAway: 'away',
                  score: '1',
                  winner: false,
                  team: { id: '2', displayName: 'Italy', logo: 'i.png' },
                },
              ],
              details: [],
            },
          ],
        },
      ],
    };
    const { matches } = soccerAdapter.transform(aet, {});
    const m = matches[0];
    expect(m.finishType).toBe('aet');
    expect(m.homeShootoutScore).toBeUndefined();
    expect(m.awayShootoutScore).toBeUndefined();
  });

  it('tolerates empty payloads without throwing', () => {
    const { matches, standings: sd, scorers } = soccerAdapter.transform({}, {});
    expect(matches).toEqual([]);
    expect(sd).toEqual({ kind: 'soccer', groups: [] });
    expect(scorers).toEqual([]);
  });

  it('preserves numeric scores returned by ESPN', () => {
    const withNumericScores = structuredClone(scoreboard);
    withNumericScores.events[0].competitions[0].competitors[0].score = 2 as unknown as string;
    withNumericScores.events[0].competitions[0].competitors[1].score = 0 as unknown as string;

    const { matches } = soccerAdapter.transform(withNumericScores, standings);
    expect(matches[0].homeScore).toBe(2);
    expect(matches[0].awayScore).toBe(0);
  });

  it('uses form from the latest event even when events arrive out of order', () => {
    const event = (id: string, date: string, form: string) => ({
      id,
      date,
      season: { slug: 'group-stage' },
      competitions: [
        {
          status: { type: { state: 'post' } },
          competitors: [
            {
              homeAway: 'home',
              score: '1',
              form,
              team: { id: '1', displayName: 'Mexico' },
            },
            {
              homeAway: 'away',
              score: '0',
              team: { id: '2', displayName: 'South Africa' },
            },
          ],
        },
      ],
    });
    const outOfOrder = {
      events: [
        event('new', '2026-06-20T19:00Z', 'WWDWW'),
        event('old', '2026-06-10T19:00Z', 'LLDLL'),
      ],
    };

    const { standings: result } = soccerAdapter.transform(outOfOrder, standings);
    if (result.kind !== 'soccer') throw new Error('expected soccer');
    expect(result.groups[0].standings[0].form).toBe('WWDWW');
  });
});

// --- transformSummary (lifted from espn.test.ts parseSummary cases) ---
const summary = {
  header: {
    competitions: [
      {
        competitors: [
          { homeAway: 'home', team: { id: '203' } },
          { homeAway: 'away', team: { id: '467' } },
        ],
      },
    ],
  },
  boxscore: {
    teams: [
      {
        team: { id: '203' },
        statistics: [
          { label: 'Possession', displayValue: '54%' },
          { label: 'Shots', displayValue: '21' },
        ],
      },
      {
        team: { id: '467' },
        statistics: [
          { label: 'Possession', displayValue: '46%' },
          { label: 'Shots', displayValue: '14' },
        ],
      },
    ],
  },
  commentary: [
    { time: { displayValue: '' }, text: 'First Half begins.' },
    { time: { displayValue: "3'" }, text: 'Foul by Aubrey Modiba.' },
  ],
  keyEvents: [
    {
      clock: { displayValue: "9'" },
      type: { text: 'Goal' },
      team: { id: '203' },
      text: 'Goal! Mexico 1, South Africa 0.',
    },
  ],
  rosters: [
    {
      team: { id: '203', displayName: 'Mexico' },
      formation: '4-1-4-1',
      roster: [
        {
          starter: true,
          jersey: '1',
          position: { abbreviation: 'G' },
          athlete: { displayName: 'Raúl Rangel' },
          plays: [],
        },
        {
          starter: true,
          jersey: '6',
          position: { abbreviation: 'DM' },
          athlete: { displayName: 'Érik Lira' },
          subbedOut: true,
          plays: [
            { clock: { displayValue: "76'" }, substitution: true },
            { clock: { displayValue: "40'" }, yellowCard: true },
          ],
        },
      ],
    },
    { team: { id: '467', displayName: 'South Africa' }, formation: '4-3-3', roster: [] },
  ],
  gameInfo: {
    venue: { fullName: 'Estadio Banorte', address: { city: 'Mexico City' } },
    attendance: 80824,
  },
};

describe('soccerAdapter.transformSummary', () => {
  const d = soccerAdapter.transformSummary(summary);

  it('tags the detail as soccer', () => {
    expect(d.kind).toBe('soccer');
  });

  it('pairs team stats by label (home/away from competitor sides)', () => {
    if (d.kind !== 'soccer') throw new Error('expected soccer');
    expect(d.homeId).toBe('203');
    expect(d.awayId).toBe('467');
    expect(d.stats).toEqual([
      { label: 'Possession', home: '54%', away: '46%' },
      { label: 'Shots', home: '21', away: '14' },
    ]);
  });

  it('keeps a stat that is present only for the away team', () => {
    const awayOnly = structuredClone(summary);
    awayOnly.boxscore.teams[1].statistics.push({ label: 'Corners', displayValue: '7' });
    const parsed = soccerAdapter.transformSummary(awayOnly);
    if (parsed.kind !== 'soccer') throw new Error('expected soccer');
    expect(parsed.stats).toContainEqual({ label: 'Corners', home: '', away: '7' });
  });

  it('reads commentary as allPlays and keyEvents as keyPlays', () => {
    if (d.kind !== 'soccer') throw new Error('expected soccer');
    expect(d.allPlays).toHaveLength(2);
    expect(d.allPlays[1]).toEqual({
      clock: "3'",
      text: 'Foul by Aubrey Modiba.',
      teamId: null,
      type: '',
    });
    expect(d.keyPlays[0]).toEqual({
      clock: "9'",
      text: 'Goal! Mexico 1, South Africa 0.',
      teamId: '203',
      type: 'Goal',
    });
  });

  it('parses lineups with sub minute and card from player.plays', () => {
    if (d.kind !== 'soccer') throw new Error('expected soccer');
    const mex = d.lineups[0];
    expect(mex.formation).toBe('4-1-4-1');
    expect(mex.players[0]).toMatchObject({
      jersey: '1',
      name: 'Raúl Rangel',
      pos: 'G',
      starter: true,
    });
    expect(mex.players[1]).toMatchObject({ subbedOutAt: "76'", card: 'yellow' });
  });

  it('reads venue and attendance', () => {
    if (d.kind !== 'soccer') throw new Error('expected soccer');
    expect(d.venue).toBe('Estadio Banorte · Mexico City');
    expect(d.attendance).toBe(80824);
  });

  it('tolerates an empty object without throwing', () => {
    const empty = soccerAdapter.transformSummary({});
    if (empty.kind !== 'soccer') throw new Error('expected soccer');
    expect(empty.stats).toEqual([]);
    expect(empty.lineups).toEqual([]);
    expect(empty.attendance).toBeNull();
  });

  it('orders lineups [home, away] even when rosters arrive away-first', () => {
    const awayFirst = { ...summary, rosters: [...summary.rosters].reverse() };
    const parsed = soccerAdapter.transformSummary(awayFirst);
    if (parsed.kind !== 'soccer') throw new Error('expected soccer');
    expect(parsed.lineups[0].teamId).toBe(parsed.homeId);
    expect(parsed.lineups[1].teamId).toBe(parsed.awayId);
  });

  it('drops keyEvents without text (admin entries)', () => {
    const withAdmin = {
      ...summary,
      keyEvents: [
        { clock: { displayValue: "0'" }, type: { text: 'Kickoff' }, team: { id: '203' }, text: '' },
        {
          clock: { displayValue: "9'" },
          type: { text: 'Goal' },
          team: { id: '203' },
          text: 'Goal!',
        },
      ],
    };
    const parsed = soccerAdapter.transformSummary(withAdmin);
    if (parsed.kind !== 'soccer') throw new Error('expected soccer');
    expect(parsed.keyPlays).toHaveLength(1);
    expect(parsed.keyPlays[0].text).toBe('Goal!');
  });
});
