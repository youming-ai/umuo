// Single source of truth for the competitions the news desk covers. Pure
// data + a pure function — no DOM/React deps — so both build targets
// (app tsconfig + tsconfig.worker.json) compile it. The ESPN scoreboard plane
// (scoreboard/standings/summary/teams/…) was removed with the competition
// pages; what survives of ESPN here is the league-scoped NEWS feed, which the
// ingest pipeline polls as one of its sources.

// Football-only product: the union existed for the removed basketball plane.
export type Sport = 'soccer';

export interface Competition {
  key: string; // URL first segment, e.g. 'eng.1'
  sport: Sport;
  league: string; // ESPN league slug (== key for the soccer leagues)
  label: string; // display name
}

const league = (key: string, label: string): Competition => ({
  key,
  sport: 'soccer',
  league: key,
  label,
});

// The editorial product is football-only; every public news surface and
// ingestion source derives from this registry.
export const FOOTBALL_COMPETITIONS: Record<string, Competition> = {
  'eng.1': league('eng.1', 'Premier League'),
  'esp.1': league('esp.1', 'La Liga'),
  'ger.1': league('ger.1', 'Bundesliga'),
  'ita.1': league('ita.1', 'Serie A'),
  'fra.1': league('fra.1', 'Ligue 1'),
  'uefa.champions': league('uefa.champions', 'Champions League'),
};

const ESPN = 'https://site.api.espn.com/apis';

export function buildUrl(c: Competition): string {
  return `${ESPN}/site/v2/sports/${c.sport}/${c.league}/news?limit=50`;
}
