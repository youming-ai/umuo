// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseExploreCursor } from './api';

describe('parseExploreCursor', () => {
  it('splits a cursor into its published_at and id halves', () => {
    expect(parseExploreCursor('1785991006396:abc123')).toEqual([1785991006396, 'abc123']);
  });

  it('keeps colons that belong to the id', () => {
    // Article ids are SHA-256 hex today, but splitting on the first colon means
    // an id that ever contains one still round-trips.
    expect(parseExploreCursor('1700000000000:a:b:c')).toEqual([1700000000000, 'a:b:c']);
  });

  it('returns null for anything unusable, so the caller falls back to page one', () => {
    for (const bad of [undefined, '', 'nocolon', ':abc', '1785991006396:', 'abc:def']) {
      expect(parseExploreCursor(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects the old numeric offset cursors rather than misreading them', () => {
    // Pre-keyset clients sent "12"/"36". Those must not parse into a boundary.
    expect(parseExploreCursor('12')).toBeNull();
    expect(parseExploreCursor('36')).toBeNull();
  });
});
