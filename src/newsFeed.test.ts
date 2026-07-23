import { describe, expect, it } from 'vitest';
import { parseNewsFeed, prioritizeNewsForComp } from './newsFeed';
import type { NewsItem } from './types';

const feed = {
  headlines: [
    {
      id: 49074981,
      headline: 'Cape Verde hold Spain',
      description: 'A day of draws',
      published: '2026-06-16T03:20:39Z',
      byline: 'ESPN Staff',
      images: [{ url: 'https://a.espncdn.com/x.jpg', name: 'x' }],
      links: { web: { href: 'https://www.espn.com/story/1' } },
      categories: [
        { type: 'contributor', description: 'ESPN Staff Profile' },
        {
          type: 'team',
          teamId: 289200,
          description: 'Wests Tigers',
          team: { id: 289200, abbreviation: 'WES' },
        },
        { type: 'athlete', athleteId: 31870, description: 'Max Kepler', athlete: { id: 31870 } },
        {
          type: 'league',
          leagueId: 8370,
          description: 'National Rugby League',
          league: { id: 8370, abbreviation: 'NRL' },
        },
        {
          type: 'team',
          teamId: 289200,
          description: 'Wests Tigers',
          team: { id: 289200, abbreviation: 'WES' },
        },
      ],
    },
  ],
};

describe('parseNewsFeed', () => {
  it('maps headlines into NewsItem with the first image and external link', () => {
    const items = parseNewsFeed(feed);
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0.id).toBe('49074981');
    expect(it0.headline).toBe('Cape Verde hold Spain');
    expect(it0.imageUrl).toBe('https://a.espncdn.com/x.jpg');
    expect(it0.link).toBe('https://www.espn.com/story/1');
    expect(it0.byline).toBe('ESPN Staff');
  });

  it('extracts team/athlete/league tags, dedupes, and lowercases the team abbrev', () => {
    const tags = parseNewsFeed(feed)[0].tags;
    expect(tags).toEqual([
      { kind: 'team', label: 'Wests Tigers', team: 'wes' },
      { kind: 'athlete', label: 'Max Kepler' },
      { kind: 'league', label: 'National Rugby League' },
    ]);
  });

  it('parses leagueSlug from category league href', () => {
    const sampleFeed = {
      headlines: [
        {
          id: 1001,
          headline: 'Test Headline',
          categories: [
            {
              type: 'league',
              description: 'Spanish LALIGA',
              league: {
                id: 740,
                links: {
                  web: { leagues: { href: 'https://www.espn.com/soccer/league/_/name/esp.1' } },
                },
              },
            },
          ],
        },
      ],
    };
    const tags = parseNewsFeed(sampleFeed)[0].tags;
    expect(tags).toEqual([{ kind: 'league', label: 'Spanish LALIGA', leagueSlug: 'esp.1' }]);
  });

  it('is defensive: junk in yields an empty array, missing fields default', () => {
    expect(parseNewsFeed(null)).toEqual([]);
    expect(parseNewsFeed({})).toEqual([]);
    expect(parseNewsFeed({ headlines: [{}] })).toEqual([
      {
        id: '',
        headline: '',
        description: '',
        published: '',
        byline: '',
        imageUrl: '',
        link: '',
        tags: [],
      },
    ]);
  });
});

// Minimal NewsItem factory for sort tests.
function newsItem(id: string, tags: NewsItem['tags']): NewsItem {
  return {
    id,
    headline: id,
    description: '',
    published: '',
    byline: '',
    imageUrl: '',
    link: '',
    tags,
  };
}

describe('prioritizeNewsForComp', () => {
  it('floats items matching the competition league slug to the top', () => {
    const items = [
      newsItem('generic', [{ kind: 'league', label: 'Soccer' }]),
      newsItem('esp', [{ kind: 'league', label: 'Spanish LALIGA', leagueSlug: 'esp.1' }]),
    ];
    const sorted = prioritizeNewsForComp(items, { league: 'esp.1', label: 'Spanish LALIGA' });
    expect(sorted.map((i) => i.id)).toEqual(['esp', 'generic']);
  });

  it('matches by label substring when leagueSlug is absent', () => {
    const items = [
      newsItem('generic', [{ kind: 'league', label: 'Soccer' }]),
      newsItem('epl', [{ kind: 'league', label: 'English Premier League' }]),
    ];
    const sorted = prioritizeNewsForComp(items, { league: 'eng.1', label: 'Premier League' });
    expect(sorted.map((i) => i.id)).toEqual(['epl', 'generic']);
  });

  it('preserves relative order within matched and unmatched groups', () => {
    const items = [
      newsItem('a-generic', [{ kind: 'league', label: 'Soccer' }]),
      newsItem('b-match', [{ kind: 'league', label: 'Premier League', leagueSlug: 'eng.1' }]),
      newsItem('c-generic', [{ kind: 'league', label: 'Soccer' }]),
      newsItem('d-match', [{ kind: 'league', label: 'Premier League', leagueSlug: 'eng.1' }]),
    ];
    const sorted = prioritizeNewsForComp(items, { league: 'eng.1', label: 'Premier League' });
    expect(sorted.map((i) => i.id)).toEqual(['b-match', 'd-match', 'a-generic', 'c-generic']);
  });
});
