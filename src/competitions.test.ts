import { describe, expect, it } from 'vitest';
import { buildUrl, COMPETITIONS, DEFAULT_COMPETITION, seasonForDate } from './competitions';

describe('buildUrl', () => {
  it('includes the date window when a competition sets dates', () => {
    const c = { ...COMPETITIONS['eng.1'], dates: '20260611-20260719' };
    expect(buildUrl(c, 'scoreboard')).toContain('dates=20260611-20260719');
  });

  it('includes the standings level when a competition sets one', () => {
    const c = { ...COMPETITIONS['eng.1'], standingsLevel: 3 };
    expect(buildUrl(c, 'standings')).toContain('level=3');
  });

  it('builds the standings URL WITHOUT the site/ path segment', () => {
    expect(buildUrl(COMPETITIONS['eng.1'], 'standings')).toBe(
      `https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings?season=${seasonForDate('soccer', new Date())}`,
    );
  });

  it('builds the summary URL with the event id', () => {
    expect(buildUrl(COMPETITIONS['eng.1'], 'summary', '760420')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=760420',
    );
  });
});

describe('registry', () => {
  it('exposes the default competition', () => {
    expect(COMPETITIONS[DEFAULT_COMPETITION]).toBeDefined();
    expect(COMPETITIONS[DEFAULT_COMPETITION].sport).toBe('soccer');
  });
});

describe('eng.1 (season-shape league)', () => {
  const pl = COMPETITIONS['eng.1'];

  it('is registered as a season-shape soccer league', () => {
    expect(pl).toBeDefined();
    expect(pl.sport).toBe('soccer');
    expect(pl.shape).toBe('season');
  });

  it('exposes scorers (leaders pipeline)', () => {
    expect(pl.capabilities.scorers).toBe(true);
    expect(pl.leadersSource).toBe('pipeline');
  });

  it('builds a standings URL with no level and a scoreboard URL with no dates', () => {
    // season is derived at request time (no hardcoded year) — assert via the same helper
    expect(buildUrl(pl, 'standings')).toBe(
      `https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings?season=${seasonForDate('soccer', new Date())}`,
    );
    expect(buildUrl(pl, 'scoreboard')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?limit=300',
    );
  });
});

describe('seasonForDate', () => {
  it('soccer rolls over in August (ESPN keys cross-year seasons by starting year)', () => {
    expect(seasonForDate('soccer', new Date(2026, 7, 1))).toBe(2026); // Aug 1 → new season
    expect(seasonForDate('soccer', new Date(2026, 6, 31))).toBe(2025); // Jul 31 → still 2025-26
    expect(seasonForDate('soccer', new Date(2027, 0, 15))).toBe(2026); // mid-season January
  });

  it('basketball rolls over in October and keys by the ENDING year', () => {
    expect(seasonForDate('basketball', new Date(2026, 9, 1))).toBe(2027); // Oct 1 2026 → 2026-27 → 2027
    expect(seasonForDate('basketball', new Date(2026, 8, 30))).toBe(2026); // Sep 30 → off-season → just-ended 2025-26 → 2026
    expect(seasonForDate('basketball', new Date(2027, 0, 15))).toBe(2027); // mid-season January → 2027
    expect(seasonForDate('basketball', new Date(2027, 5, 20))).toBe(2027); // June (finals) → 2027
  });
});

describe('nba (season-shape basketball)', () => {
  const nba = COMPETITIONS.nba;

  it('is registered as a season-shape basketball league', () => {
    expect(nba).toBeDefined();
    expect(nba.sport).toBe('basketball');
    expect(nba.shape).toBe('season');
    expect(nba.league).toBe('nba');
    expect(nba.label).toBe('NBA');
  });

  it('exposes boxscore and scorers capabilities', () => {
    expect(nba.capabilities).toEqual({
      scorers: true,
      lineups: false,
      boxscore: true,
      transactions: true,
      odds: true,
    });
    expect(nba.leadersSource).toBe('pipeline');
  });

  it('builds NBA URLs: basketball path, derived season, no level, no dates', () => {
    expect(buildUrl(nba, 'standings')).toBe(
      `https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${seasonForDate('basketball', new Date())}`,
    );
    expect(buildUrl(nba, 'scoreboard')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?limit=300',
    );
    expect(buildUrl(nba, 'summary', '401585')).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401585',
    );
  });
});
