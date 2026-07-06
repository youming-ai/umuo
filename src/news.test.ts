import { describe, expect, it } from 'vitest';
import { buildNewsUrl, newsCacheKey, newsFresh, newsParamsFromQuery } from './news';

describe('newsParamsFromQuery', () => {
  it('defaults to empty params when there is no query', () => {
    expect(newsParamsFromQuery(new URLSearchParams(''))).toEqual({});
  });
  it('clamps limit to 50 and floors fractional values', () => {
    expect(newsParamsFromQuery(new URLSearchParams('limit=200')).limit).toBe(50);
    expect(newsParamsFromQuery(new URLSearchParams('limit=7.9')).limit).toBe(7);
  });
  it('clamps a positive sub-1 limit up to the lower bound of 1', () => {
    expect(newsParamsFromQuery(new URLSearchParams('limit=0.5')).limit).toBe(1);
  });
  it('ignores a non-positive or non-numeric limit', () => {
    expect(newsParamsFromQuery(new URLSearchParams('limit=0')).limit).toBeUndefined();
    expect(newsParamsFromQuery(new URLSearchParams('limit=abc')).limit).toBeUndefined();
  });
  it('whitelists only sport/leagues/team and drops anything else', () => {
    const p = newsParamsFromQuery(
      new URLSearchParams('sport=soccer&leagues=eng.1&team=che&evil=1'),
    );
    expect(p).toEqual({ sport: 'soccer', leagues: 'eng.1', team: 'che' });
  });
});

describe('buildNewsUrl', () => {
  it('builds the global feed with default limit 20', () => {
    expect(buildNewsUrl({})).toBe('https://now.core.api.espn.com/v1/sports/news?limit=20');
  });
  it('appends whitelisted filters after the limit', () => {
    expect(buildNewsUrl({ limit: 10, leagues: 'nba' })).toBe(
      'https://now.core.api.espn.com/v1/sports/news?limit=10&leagues=nba',
    );
  });
});

describe('newsFresh', () => {
  it('is 120s for the unfiltered global feed', () => {
    expect(newsFresh({})).toBe(120);
  });
  it('is 300s once any filter is present', () => {
    expect(newsFresh({ leagues: 'nba' })).toBe(300);
  });
});

describe('newsCacheKey', () => {
  it('is stable and distinct per filter set', () => {
    expect(newsCacheKey({})).toBe('news::::20');
    expect(newsCacheKey({ leagues: 'nba', limit: 10 })).toBe('news::nba::10');
  });
  it('encodes components so colon-bearing inputs stay injective', () => {
    expect(newsCacheKey({ sport: 'a:', team: 'b' })).not.toBe(
      newsCacheKey({ sport: 'a', leagues: ':', team: 'b' }),
    );
  });
});
