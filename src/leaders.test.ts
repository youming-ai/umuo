import { describe, expect, it, vi } from 'vitest';
import { assembleLeaders, LEADERS_BY_SPORT, type LeadersConfig } from './leaders';

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

  it('returns [] when the category is absent', async () => {
    const fetchImpl = makeFetch({
      [LEADERS_URL]: { categories: [{ name: 'assists', leaders: [] }] },
    });
    expect(await assembleLeaders(fetchImpl, eplCfg)).toEqual([]);
  });

  it('returns [] on an empty leaders payload without throwing', async () => {
    const fetchImpl = makeFetch({ [LEADERS_URL]: {} });
    expect(await assembleLeaders(fetchImpl, eplCfg)).toEqual([]);
  });

  it('builds the core.api URL from the config (sport/league/season/type)', async () => {
    const fetchImpl = makeFetch();
    await assembleLeaders(fetchImpl, eplCfg);
    const spy = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(spy.mock.calls.some((c) => String(c[0]) === LEADERS_URL)).toBe(true);
  });
});
