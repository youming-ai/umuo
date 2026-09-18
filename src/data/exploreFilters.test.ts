// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CATEGORIES } from '../categories';
import type { Env } from './api';
import { getExploreFilters } from './api';

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

describe('getExploreFilters degradation', () => {
  it('falls back to the registry, with unknown counts, when counting fails', async () => {
    // Emptying the rail because a COUNT failed removes every route into the
    // site; rendering zeros would instead claim the hubs are empty. The
    // registry is the source of truth for what exists.
    // D1 is present and its COUNT rejects — the counting outage itself, not the
    // missing-binding check that an env without DB would exercise.
    const failing = {
      CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(function bind(this: unknown) {
            return this;
          }),
          all: vi.fn(async () => {
            throw new Error('d1 down');
          }),
        })),
      },
    } as unknown as Env;

    const filters = await getExploreFilters('', failing, ctx);

    expect(filters.categories.map((option) => option.value).sort()).toEqual(
      Object.keys(CATEGORIES).sort(),
    );
    expect(filters.categories.every((option) => option.count === null)).toBe(true);
    expect(filters.categories.every((option) => option.label.length > 0)).toBe(true);
  });
});
