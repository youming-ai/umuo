import { FOOTBALL_COMPETITIONS } from '../competitions';
import type { FeedSource } from './types';

const FOOTBALL_RSS_SOURCES: FeedSource[] = [
  {
    id: 'bbc-football',
    kind: 'rss',
    name: 'BBC Sport Football',
    url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
    sport: 'soccer',
    authorityScore: 92,
    defaultEnabled: true,
  },
  {
    id: 'guardian-football',
    kind: 'rss',
    name: 'The Guardian Football',
    url: 'https://www.theguardian.com/football/rss',
    sport: 'soccer',
    authorityScore: 88,
    defaultEnabled: true,
  },
  {
    id: 'sky-football',
    kind: 'rss',
    name: 'Sky Sports Football',
    url: 'https://www.skysports.com/rss/11095',
    sport: 'soccer',
    authorityScore: 90,
    defaultEnabled: true,
  },
  {
    id: 'independent-football',
    kind: 'rss',
    name: 'The Independent Football',
    url: 'https://www.independent.co.uk/sport/football/rss',
    sport: 'soccer',
    authorityScore: 80,
    defaultEnabled: true,
  },
  {
    id: '90min-football',
    kind: 'rss',
    name: '90min',
    url: 'https://www.90min.com/posts.rss',
    sport: 'soccer',
    authorityScore: 70,
    defaultEnabled: true,
  },
];

// Competition-scoped feeds. The publisher has already told us which league a
// story belongs to, so `comp` is attributed without waiting on AI enrichment.
// Slugs are each publisher's own (eng.1 → premierleague at the Guardian,
// premier-league at the BBC) and don't derive from our comp keys.
const GUARDIAN_COMP_SLUGS: Record<string, string> = {
  'eng.1': 'premierleague',
  'esp.1': 'laligafootball',
  'ita.1': 'serieafootball',
  'ger.1': 'bundesligafootball',
  'fra.1': 'ligue1football',
  'uefa.champions': 'championsleague',
  'eng.fa': 'fa-cup',
};

const BBC_COMP_SLUGS: Record<string, string> = {
  'eng.1': 'premier-league',
  'uefa.champions': 'champions-league',
  'uefa.europa': 'europa-league',
  'eng.fa': 'fa-cup',
};

function compSources(
  prefix: string,
  publisher: string,
  authorityScore: number,
  slugs: Record<string, string>,
  urlFor: (slug: string) => string,
): FeedSource[] {
  return Object.entries(slugs).flatMap(([comp, slug]) => {
    const competition = FOOTBALL_COMPETITIONS[comp];
    if (!competition) return [];
    return [
      {
        id: `${prefix}-${comp}`,
        kind: 'rss' as const,
        name: `${publisher} ${competition.label}`,
        url: urlFor(slug),
        sport: 'soccer' as const,
        comp,
        authorityScore,
        defaultEnabled: true,
      },
    ];
  });
}

const COMP_RSS_SOURCES: FeedSource[] = [
  ...compSources(
    'guardian',
    'The Guardian',
    88,
    GUARDIAN_COMP_SLUGS,
    (slug) => `https://www.theguardian.com/football/${slug}/rss`,
  ),
  ...compSources(
    'bbc',
    'BBC Sport',
    92,
    BBC_COMP_SLUGS,
    (slug) => `https://feeds.bbci.co.uk/sport/football/${slug}/rss.xml`,
  ),
  {
    id: 'as-esp.1',
    kind: 'rss',
    name: 'AS English La Liga',
    url: 'https://en.as.com/rss/futbol/primera.xml',
    sport: 'soccer',
    comp: 'esp.1',
    authorityScore: 78,
    defaultEnabled: true,
  },
];

// ESPN remains useful for league-scoped coverage; the per-league news feed is
// football-only even where the rest of the surface isn't.
const ESPN_SOURCES: FeedSource[] = Object.values(FOOTBALL_COMPETITIONS).map((competition) => ({
  id: `espn-${competition.key}`,
  kind: 'api-json',
  name: `ESPN ${competition.label}`,
  url: `https://site.api.espn.com/apis/site/v2/sports/${competition.sport}/${competition.league}/news?limit=100`,
  sport: 'soccer',
  comp: competition.key,
  authorityScore: 86,
  defaultEnabled: true,
}));

export const FEED_SOURCES = [
  ...FOOTBALL_RSS_SOURCES,
  ...COMP_RSS_SOURCES,
  ...ESPN_SOURCES,
] satisfies FeedSource[];

export const FEED_SOURCE_BY_ID = new Map(FEED_SOURCES.map((source) => [source.id, source]));
