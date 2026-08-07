// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeTag } from './enrich';

describe('normalizeTag', () => {
  it('collapses the spellings that split one topic into two facets', () => {
    // The exact pair that showed up twice in the rail after the first ingest.
    expect(normalizeTag('Premier League')).toBe('premier-league');
    expect(normalizeTag('premier-league')).toBe('premier-league');
    expect(normalizeTag('La Liga')).toBe('la-liga');
  });

  it('normalises padding, casing and repeated separators', () => {
    expect(normalizeTag('  Champions   League  ')).toBe('champions-league');
    expect(normalizeTag('MAN--UTD')).toBe('man-utd');
    expect(normalizeTag('-transfers-')).toBe('transfers');
  });

  it('returns an empty string for whitespace-only tags so they can be dropped', () => {
    expect(normalizeTag('   ')).toBe('');
    expect(normalizeTag('-')).toBe('');
  });
});
