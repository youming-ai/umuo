import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePolledResource } from './usePolledResource';

describe('usePolledResource', () => {
  it('consumes the SSR seed without an initial fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue(['fetched']);
    const { result } = renderHook(() =>
      usePolledResource<string[]>({
        fetcher,
        key: 'a',
        fallback: [],
        initialData: ['seed'],
        intervalMs: 60_000,
      }),
    );
    expect(result.current.data).toEqual(['seed']);
    expect(result.current.loading).toBe(false);
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not fetch while skipped', async () => {
    const fetcher = vi.fn().mockResolvedValue(['x']);
    const { result } = renderHook(() =>
      usePolledResource<string[]>({ fetcher, key: '', skip: true, fallback: [], intervalMs: 1000 }),
    );
    expect(result.current.loading).toBe(false);
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches once when no interval is set', async () => {
    const fetcher = vi.fn().mockResolvedValue(['v']);
    const { result } = renderHook(() =>
      usePolledResource<string[]>({ fetcher, key: 'a', fallback: [] }),
    );
    await waitFor(() => expect(result.current.data).toEqual(['v']));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('resets and refetches when the key changes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(['a']).mockResolvedValueOnce(['b']);
    const { result, rerender } = renderHook(
      ({ k }) => usePolledResource<string[]>({ fetcher, key: k, fallback: [] }),
      { initialProps: { k: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toEqual(['a']));
    rerender({ k: 'b' });
    await waitFor(() => expect(result.current.data).toEqual(['b']));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('surfaces an error only when there is no cached data', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() =>
      usePolledResource<string[]>({ fetcher, key: 'a', fallback: [] }),
    );
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.data).toEqual([]);
  });
});
