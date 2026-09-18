import { describe, expect, it } from 'vitest';
import { articleDeck } from './site';

describe('articleDeck', () => {
  const article = {
    summary: 'summary-first copy',
    blurb: 'blurb-first copy',
    description: 'publisher teaser',
  };

  it('prefers the blurb (card stream teaser)', () => {
    expect(articleDeck(article)).toBe('blurb-first copy');
  });

  it('falls back to the summary, then the publisher description', () => {
    expect(articleDeck({ ...article, blurb: '' })).toBe('summary-first copy');
    expect(articleDeck({ summary: '', blurb: '', description: 'teaser' })).toBe('teaser');
  });

  it('returns an empty string when nothing is set', () => {
    expect(articleDeck({})).toBe('');
  });
});
