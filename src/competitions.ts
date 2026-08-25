// Template: competition registry. Replace with your taxonomy — keys become
// URL segments (e.g. /<key>) and feed filter values.
// Example below is football; keep or replace entirely.
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
  // Top Domestic Leagues
  'eng.1': league('eng.1', 'Premier League'),
  'esp.1': league('esp.1', 'La Liga'),
  'ger.1': league('ger.1', 'Bundesliga'),
  'ita.1': league('ita.1', 'Serie A'),
  'fra.1': league('fra.1', 'Ligue 1'),
  // Continental Club Competitions
  'uefa.champions': league('uefa.champions', 'Champions League'),
  'uefa.europa': league('uefa.europa', 'Europa League'),
  // Global Tournaments
  'fifa.world': league('fifa.world', 'FIFA World Cup'),
  'fifa.cwc': league('fifa.cwc', 'Club World Cup'),
  'uefa.euro': league('uefa.euro', 'UEFA Euro'),
  'conmebol.america': league('conmebol.america', 'Copa America'),
  // Domestic Cups & Other Leagues
  'eng.fa': league('eng.fa', 'FA Cup'),
  'usa.1': league('usa.1', 'MLS'),
  'ksa.1': league('ksa.1', 'Saudi Pro League'),
};
