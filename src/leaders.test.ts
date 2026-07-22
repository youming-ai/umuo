import { describe, expect, it, vi } from 'vitest';
import {
  assembleLeaderboards,
  assembleLeaders,
  LEADERBOARDS_BY_SPORT,
  LEADERS_BY_SPORT,
  type LeadersConfig,
  normalizeRef,
} from './leaders';

// --- canned upstream payloads keyed by URL (NO network) ---
const LEADERS_URL =
  'https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/types/1/leaders';
const ATH1 = 'https://ath/1';
const ATH2 = 'https://ath/2';
const ATH3 = 'https://ath/3';
const TEAM_MCI = 'https://team/mci';
const TEAM_ARS = 'https://team/ars';

const leadersPayload = {
  categories: [
    {
      name: 'assists',
      leaders: [
        { displayValue: '10', value: 10, athlete: { $ref: ATH1 }, team: { $ref: TEAM_MCI } },
      ],
    },
    {
      name: 'goals',
      leaders: [
        // deliberately NOT pre-sorted, to prove we sort by value desc
        { displayValue: '18', value: 18, athlete: { $ref: ATH2 }, team: { $ref: TEAM_ARS } },
        { displayValue: '27', value: 27, athlete: { $ref: ATH1 }, team: { $ref: TEAM_MCI } },
        { displayValue: '9', value: 9, athlete: { $ref: ATH3 }, team: { $ref: TEAM_MCI } },
      ],
    },
  ],
};

const athletes: Record<string, unknown> = {
  [ATH1]: { displayName: 'Erling Haaland', shortName: 'E. Haaland' },
  [ATH2]: { displayName: 'Bukayo Saka', shortName: 'B. Saka' },
  [ATH3]: { displayName: 'Julián Álvarez', shortName: 'J. Álvarez' },
};
const teams: Record<string, unknown> = {
  [TEAM_MCI]: { displayName: 'Manchester City', logos: [{ href: 'mci.png' }] },
  [TEAM_ARS]: { displayName: 'Arsenal', logos: [{ href: 'ars.png' }] },
};

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

// A fake fetch that resolves each URL from the canned maps above.
function makeFetch(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    [LEADERS_URL]: leadersPayload,
    ...athletes,
    ...teams,
    ...overrides,
  };
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!(url in table)) throw new Error(`unexpected url: ${url}`);
    const body = table[url];
    if (body === '__404__') return { ok: false, json: async () => ({}) } as unknown as Response;
    return jsonResponse(body);
  }) as unknown as typeof fetch;
}

const eplCfg: LeadersConfig = {
  sport: 'soccer',
  league: 'eng.1',
  season: 2026,
  type: 1,
  category: 'goals',
  topN: 15,
};

describe('LEADERS_BY_SPORT', () => {
  it('maps soccer→goals(type 1) and basketball→points(type 2)', () => {
    expect(LEADERS_BY_SPORT.soccer).toEqual({ type: 1, category: 'goals' });
    expect(LEADERS_BY_SPORT.basketball).toEqual({ type: 2, category: 'points' });
  });
});

describe('assembleLeaders', () => {
  it('picks the configured category, sorts by value desc, ranks from 1', async () => {
    const fetchImpl = makeFetch();
    const leaders = await assembleLeaders(fetchImpl, eplCfg);
    expect(leaders.map((l) => l.rank)).toEqual([1, 2, 3]);
    expect(leaders.map((l) => l.value)).toEqual([27, 18, 9]);
    expect(leaders.map((l) => l.name)).toEqual(['Erling Haaland', 'Bukayo Saka', 'Julián Álvarez']);
    expect(leaders.map((l) => l.displayValue)).toEqual(['27', '18', '9']);
  });

  it('resolves athlete name and team name/logo from the $refs', async () => {
    const leaders = await assembleLeaders(makeFetch(), eplCfg);
    expect(leaders[0]).toEqual({
      rank: 1,
      name: 'Erling Haaland',
      teamName: 'Manchester City',
      teamLogo: 'mci.png',
      displayValue: '27',
      value: 27,
    });
  });

  it('dedupes team $refs (two City players → the team is fetched once)', async () => {
    const fetchImpl = makeFetch();
    await assembleLeaders(fetchImpl, eplCfg);
    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const cityCalls = spy.mock.calls.filter((c) => String(c[0]) === TEAM_MCI);
    expect(cityCalls).toHaveLength(1);
  });

  it('truncates to topN before resolving refs', async () => {
    const leaders = await assembleLeaders(makeFetch(), { ...eplCfg, topN: 2 });
    expect(leaders).toHaveLength(2);
    expect(leaders.map((l) => l.value)).toEqual([27, 18]);
  });

  it('degrades a row (empty name/teamName) when a ref fetch fails, without throwing', async () => {
    // ATH2's athlete ref 404s → row keeps rank/value/displayValue but name=''.
    const fetchImpl = makeFetch({ [ATH2]: '__404__' });
    const leaders = await assembleLeaders(fetchImpl, eplCfg);
    expect(leaders).toHaveLength(3);
    const saka = leaders[1];
    expect(saka.value).toBe(18);
    expect(saka.name).toBe('');
    // teamName still resolves (Arsenal ref is fine)
    expect(saka.teamName).toBe('Arsenal');
  });

  it('throws when the configured category is absent so callers can serve stale data', async () => {
    const fetchImpl = makeFetch({
      [LEADERS_URL]: { categories: [{ name: 'assists', leaders: [] }] },
    });
    await expect(assembleLeaders(fetchImpl, eplCfg)).rejects.toThrow(
      'leaders category goals not found',
    );
  });

  it('returns [] when the configured category legitimately has no leaders', async () => {
    const fetchImpl = makeFetch({
      [LEADERS_URL]: { categories: [{ name: 'goals', leaders: [] }] },
    });
    expect(await assembleLeaders(fetchImpl, eplCfg)).toEqual([]);
  });

  // Finding 2: a primary-doc failure must THROW (not swallow to []), so the
  // Worker's cachedProducer/runCached can serve-stale instead of overwriting
  // a valid stale leaderboard with an empty one.
  it('throws when the primary leaders-doc fetch is not ok (does not swallow to [])', async () => {
    const fetchImpl = makeFetch({ [LEADERS_URL]: '__404__' });
    await expect(assembleLeaders(fetchImpl, eplCfg)).rejects.toThrow();
  });

  it('throws when the primary leaders-doc response is not valid JSON', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === LEADERS_URL) {
        return {
          ok: true,
          json: async () => {
            throw new SyntaxError('Unexpected token');
          },
        } as unknown as Response;
      }
      throw new Error(`unexpected url: ${String(input)}`);
    }) as unknown as typeof fetch;
    await expect(assembleLeaders(fetchImpl, eplCfg)).rejects.toThrow();
  });

  it('builds the core.api URL from the config (sport/league/season/type)', async () => {
    const fetchImpl = makeFetch();
    await assembleLeaders(fetchImpl, eplCfg);
    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(spy.mock.calls.some((c) => String(c[0]) === LEADERS_URL)).toBe(true);
  });

  // pseudo-r/Public-ESPN-API gotcha: core.api $ref URLs sometimes point at the
  // internal sports.core.api.espn.pvt host, which is not publicly resolvable.
  // We rewrite .pvt → .com so the ref resolves; without it the fake fetch
  // would throw on the unknown .pvt URL and the row would degrade to name=''.
  it('rewrites ESPN internal .pvt refs to .com before fetching', async () => {
    const pvtAthlete =
      'https://sports.core.api.espn.pvt/v2/sports/soccer/leagues/eng.1/athletes/999';
    const comAthlete =
      'https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/athletes/999';
    const fetchImpl = makeFetch({
      [LEADERS_URL]: {
        categories: [
          {
            name: 'goals',
            leaders: [
              {
                displayValue: '20',
                value: 20,
                athlete: { $ref: pvtAthlete },
                team: { $ref: TEAM_MCI },
              },
            ],
          },
        ],
      },
      [comAthlete]: { displayName: 'Pvt-Resolved Player' },
    });
    const leaders = await assembleLeaders(fetchImpl, eplCfg);
    expect(leaders[0].name).toBe('Pvt-Resolved Player');
    // the .com URL was fetched, the internal .pvt URL never was
    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(spy.mock.calls.some((c) => String(c[0]) === comAthlete)).toBe(true);
    expect(spy.mock.calls.some((c) => String(c[0]) === pvtAthlete)).toBe(false);
  });
});

describe('normalizeRef', () => {
  it('rewrites the internal .pvt host to the public .com host', () => {
    expect(
      normalizeRef('https://sports.core.api.espn.pvt/v2/sports/soccer/leagues/eng.1/athletes/1'),
    ).toBe('https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/athletes/1');
  });

  it('leaves already-public .com refs untouched', () => {
    const ref = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/athletes/1';
    expect(normalizeRef(ref)).toBe(ref);
  });

  it('does not touch unrelated .pvt substrings in other hosts', () => {
    const ref = 'https://something.else.pvt/foo';
    expect(normalizeRef(ref)).toBe(ref);
  });
});

describe('assembleLeaderboards', () => {
  const cfg = { sport: 'soccer', league: 'eng.1', season: 2026, type: 1, topN: 15 };

  it('assembles multiple grouped boards from one doc, dropping empty categories', async () => {
    const specs = [
      { category: 'goals', label: 'Goals', group: 'Scoring' },
      { category: 'assists', label: 'Assists', group: 'Scoring' },
      { category: 'saves', label: 'Saves', group: 'Goalkeeping' }, // absent → dropped
    ];
    const boards = await assembleLeaderboards(makeFetch(), cfg, specs);
    expect(boards.map((b) => b.key)).toEqual(['goals', 'assists']);
    const goals = boards[0];
    expect(goals.label).toBe('Goals');
    expect(goals.group).toBe('Scoring');
    // sorted by value desc, refs resolved to names + team logos
    expect(goals.leaders.map((l) => l.name)).toEqual([
      'Erling Haaland',
      'Bukayo Saka',
      'Julián Álvarez',
    ]);
    expect(goals.leaders[0]).toMatchObject({
      rank: 1,
      displayValue: '27',
      teamName: 'Manchester City',
      teamLogo: 'mci.png',
    });
  });

  it('throws when the leaders doc fetch fails (so serve-stale can cover it)', async () => {
    const fetchImpl = makeFetch({ [LEADERS_URL]: '__404__' });
    await expect(
      assembleLeaderboards(fetchImpl, cfg, [
        { category: 'goals', label: 'Goals', group: 'Scoring' },
      ]),
    ).rejects.toThrow();
  });

  it('curates board specs per sport', () => {
    expect(LEADERBOARDS_BY_SPORT.soccer.some((s) => s.category === 'goals')).toBe(true);
    expect(LEADERBOARDS_BY_SPORT.basketball.some((s) => s.category === 'pointsPerGame')).toBe(true);
  });
});
