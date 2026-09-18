// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseExploreCursor } from './api';

describe('parseExploreCursor', () => {
  it('splits a cursor into its day, quality, published_at, and id parts', () => {
    expect(parseExploreCursor('20530:91:1785991006396:abc123')).toEqual([
      20530,
      91,
      1785991006396,
      'abc123',
    ]);
  });

  it('keeps colons that belong to the id', () => {
    // Article ids are SHA-256 hex today, but splitting on the first three colons
    // means an id that ever contains one still round-trips.
    expect(parseExploreCursor('20530:70:1700000000000:a:b:c')).toEqual([
      20530,
      70,
      1700000000000,
      'a:b:c',
    ]);
  });

  it('returns null for anything unusable, so the caller falls back to page one', () => {
    for (const bad of [
      undefined,
      '',
      'nocolon',
      ':abc',
      '91:1785991006396:abc123', // legacy 3-part cursor — must collapse, not misread
      '20530:91:1785991006396:',
      '20530:91::abc',
      'abc:def:ghi:jkl',
    ]) {
      expect(parseExploreCursor(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects the old numeric offset cursors rather than misreading them', () => {
    // Pre-keyset clients sent "12"/"36". Those must not parse into a boundary.
    expect(parseExploreCursor('12')).toBeNull();
    expect(parseExploreCursor('36')).toBeNull();
  });

  it('rejects an impossible cursor rather than seeking past the corpus', () => {
    // Every sort key is non-negative, so a negative part cannot come from a
    // row. Left to reach the query it seeks past everything and renders an
    // empty board under "No links match these filters" — blaming the reader's
    // filters for a hand-edited URL.
    expect(parseExploreCursor('-1:80:1789707171000:abc')).toBeNull();
    expect(parseExploreCursor('20714:-1:1789707171000:abc')).toBeNull();
    expect(parseExploreCursor('20714:80:-1:abc')).toBeNull();
    // The boundary itself is legitimate: bucket 0 is the epoch day.
    expect(parseExploreCursor('0:0:0:abc')).toEqual([0, 0, 0, 'abc']);
  });
});
