import { describe, expect, it } from 'vitest';
import { slugify, timeAgo } from './helpers';

describe('timeAgo', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');
  it('formats past timestamps by largest fitting unit', () => {
    expect(timeAgo('2026-07-24T10:00:00Z', now)).toBe('2 hours ago');
    expect(timeAgo('2026-07-22T12:00:00Z', now)).toBe('2 days ago');
    expect(timeAgo('2026-07-24T11:59:30Z', now)).toBe('30 seconds ago');
  });
  it('returns empty string for missing/invalid input', () => {
    expect(timeAgo(undefined, now)).toBe('');
    expect(timeAgo('not-a-date', now)).toBe('');
  });
});

describe('slugify', () => {
  it('should convert mixed case and spaces to kebab-case', () => {
    expect(slugify('Colombia vs. Congo DR')).toBe('colombia-vs-congo-dr');
    expect(slugify('Atlanta Braves vs. San Diego Padres')).toBe(
      'atlanta-braves-vs-san-diego-padres',
    );
  });

  it('should handle special characters', () => {
    expect(slugify('France 3 Nord Pas-de-Calais HD')).toBe('france-3-nord-pas-de-calais-hd');
    expect(slugify('H@ll0 W0rld!')).toBe('hll0-w0rld');
  });

  it('should handle leading/trailing spaces and multiple dashes', () => {
    expect(slugify('  Hello   World  ')).toBe('hello-world');
  });

  it("strips accented letters via NFD normalization (Côte d'Ivoire, São Paulo)", () => {
    expect(slugify("Côte d'Ivoire")).toBe('cote-divoire');
    expect(slugify('São Paulo')).toBe('sao-paulo');
    expect(slugify('Ñoño FC')).toBe('nono-fc');
  });

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });
});
