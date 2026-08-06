import { FOOTBALL_COMPETITIONS } from '../competitions';
import { describe, expect, it } from 'vitest';
import { FEED_SOURCES, FEED_SOURCE_BY_ID } from './sources';

describe('feed sources', () => {
  it('has unique ids and https urls', () => {
    expect(FEED_SOURCE_BY_ID.size).toBe(FEED_SOURCES.length);
    for (const source of FEED_SOURCES) {
      expect(source.url.startsWith('https://'), source.id).toBe(true);
      expect(source.authorityScore).toBeGreaterThan(0);
      expect(source.authorityScore).toBeLessThanOrEqual(100);
    }
  });

  it('scopes every competition feed to a real competition key', () => {
    const scoped = FEED_SOURCES.filter((source) => source.comp);
    // 6 Guardian + 2 BBC + AS + 6 ESPN
    expect(scoped.length).toBe(15);
    for (const source of scoped) {
      expect(Object.keys(FOOTBALL_COMPETITIONS), source.id).toContain(source.comp);
    }
  });
});
