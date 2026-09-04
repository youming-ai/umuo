import { CATEGORIES } from '../categories';
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

  it('scopes every vertical feed to a real category key', () => {
    const scoped = FEED_SOURCES.filter((source) => source.category);
    // TFT Central + Keyboard Newswire + KBD.news + r/MechanicalKeyboards +
    // r/MouseReview + the four AI desks (OpenAI, DeepMind, Google AI, HF)
    expect(scoped.length).toBe(9);
    for (const source of scoped) {
      expect(Object.keys(CATEGORIES), source.id).toContain(source.category);
    }
  });

  it('keeps the registry self-check honest: no duplicate ids', () => {
    const ids = new Set(FEED_SOURCES.map((source) => source.id));
    expect(ids.size).toBe(FEED_SOURCES.length);
  });
});
