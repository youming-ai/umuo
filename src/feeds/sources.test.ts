import { describe, expect, it } from 'vitest';
import { FEED_SOURCES } from './sources';

describe('feed sources', () => {
  it('has unique ids and https urls', () => {
    expect(new Set(FEED_SOURCES.map((source) => source.id)).size).toBe(FEED_SOURCES.length);
    for (const source of FEED_SOURCES) {
      expect(source.url.startsWith('https://'), source.id).toBe(true);
      expect(source.authorityScore).toBeGreaterThan(0);
      expect(source.authorityScore).toBeLessThanOrEqual(100);
    }
  });
});
