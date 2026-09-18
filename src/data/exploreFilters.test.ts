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
    const failing = {
      CACHE: { get: vi.fn().mockRejectedValue(new Error('kv down')), put: vi.fn() },
    } as unknown as Env;

    const filters = await getExploreFilters('', failing, ctx);

    expect(filters.categories.map((option) => option.value).sort()).toEqual(
      Object.keys(CATEGORIES).sort(),
    );
    expect(filters.categories.every((option) => option.count === null)).toBe(true);
    expect(filters.categories.every((option) => option.label.length > 0)).toBe(true);
  });
});
