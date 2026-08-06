import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from './ingest';

describe('canonicalizeUrl', () => {
  it('removes tracking parameters while preserving editorial query parameters', () => {
    expect(
      canonicalizeUrl('HTTPS://WWW.Example.com/story/?utm_source=feed&FBCLID=abc&page=2#comments'),
    ).toBe('https://www.example.com/story?page=2');
  });

  it('returns non-URL input without throwing', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });
});
