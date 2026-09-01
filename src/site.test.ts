import { describe, expect, it } from 'vitest';
import { articleDeck } from './site';

describe('articleDeck', () => {
  const article = {
    summary: 'summary-first copy',
    blurb: 'blurb-first copy',
    description: 'publisher teaser',
  };

  it('prefers the blurb in short mode (card stream teaser)', () => {
    expect(articleDeck(article, 'short')).toBe('blurb-first copy');
  });

  it('prefers the summary in long mode (detail page & RSS)', () => {
    expect(articleDeck(article, 'long')).toBe('summary-first copy');
  });

  it('falls all the way through to the publisher description', () => {
    expect(articleDeck({ summary: '', blurb: '', description: 'teaser' }, 'short')).toBe('teaser');
    expect(articleDeck({ summary: '', blurb: '', description: 'teaser' }, 'long')).toBe('teaser');
  });

  it('returns an empty string when nothing is set', () => {
    expect(articleDeck({}, 'short')).toBe('');
    expect(articleDeck({}, 'long')).toBe('');
  });

  it('defaults to short mode', () => {
    expect(articleDeck(article)).toBe('blurb-first copy');
  });
});
