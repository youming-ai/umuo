// Football-only product. The ESPN league-news feed is the only ESPN surface
// that still runs.
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
