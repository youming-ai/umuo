import { describe, expect, it } from 'vitest';
import { parseNewsFeed } from './newsFeed';

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
