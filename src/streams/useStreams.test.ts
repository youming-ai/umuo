import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStreams } from './useStreams';

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

describe('useStreams (football only)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('keeps only the Football category and ignores American Football', async () => {
    const payload = {
      streams: [
        {
          category: 'American Football',
          streams: [{ id: 1, name: 'CFL Game', iframe: 'x', viewers: '0' }],
        },
        {
          category: 'Football',
          streams: [
            {
              id: 23637,
              name: 'Bosnia-Herzegovina vs. Qatar',
              category_name: 'Football',
              iframe: 'https://embedindia.st/embed/wc/bih-qat',
              viewers: '4',
              poster: 'p.jpg',
              colors: ['#112855', '#691a40'],
              substreams: [
                {
                  id: 23638,
                  name: 'B vs Q',
                  tag: 'WC',
                  source_tag: 'FS1',
                  locale: 'en',
                  iframe: 'https://embedindia.st/embed/wc/bih-qat-fs1',
                },
              ],
            },
          ],
        },
      ],
    };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useStreams());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].name).toBe('Bosnia-Herzegovina vs. Qatar');
    expect(result.current.matches[0].colors).toEqual(['#112855', '#691a40']);
    expect(result.current.matches[0].substreams).toHaveLength(1);
    expect(result.current.matches[0].slug).toBe('bosnia-herzegovina-vs-qatar');
  });

  it('drops Football streams that do not expose a trusted iframe URL', async () => {
    const payload = {
      streams: [
        {
          category: 'Football',
          streams: [
            {
              id: 1,
              name: 'Unsafe Game',
              iframe: 'javascript:alert(1)',
              substreams: [
                { name: 'bad', source_tag: 'bad', iframe: 'https://evil.example/embed' },
              ],
            },
          ],
        },
      ],
    };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useStreams());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.matches).toHaveLength(0);
  });

  it('sets error on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    const { result } = renderHook(() => useStreams());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to fetch streams');
  });

  it('sets error when fetch throws (network failure)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const { result } = renderHook(() => useStreams());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // AbortError is swallowed; real network errors surface as the error string
    expect(result.current.error).toBeTruthy();
  });

  it('returns empty matches when Football category has no streams', async () => {
    const payload = {
      streams: [{ category: 'Football', streams: [] }],
    };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => payload });
    const { result } = renderHook(() => useStreams());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.matches).toHaveLength(0);
  });

  it('returns empty matches when no Football category exists', async () => {
    const payload = {
      streams: [
        { category: 'Basketball', streams: [{ id: 1, name: 'Game', iframe: 'x', viewers: '0' }] },
      ],
    };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => payload });
    const { result } = renderHook(() => useStreams());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.matches).toHaveLength(0);
  });

  const altPayload = [
    {
      category: 'Events',
      events: [
        {
          name: 'USA vs Bosnia-Herzegovina',
          logo: 'l.jpg',
          time: '2026-07-01T20:00',
          streams: [
            { name: 'FOX USA', url: 'https://vileembeds.pages.dev/embed/fox-usa' },
            { name: 'Telemundo', url: 'https://vileembeds.pages.dev/embed/telemundo-usa' },
            { name: 'Bad', url: 'https://evil.example/embed' },
          ],
        },
        { name: 'No trusted urls', streams: [{ name: 'x', url: 'https://evil.example/e' }] },
      ],
    },
    {
      category: '24/7',
      events: [
        { name: 'ABC', streams: [{ name: 'ABC', url: 'https://vileembeds.pages.dev/abc' }] },
      ],
    },
  ];

  it('merges the alt source after ppv and adapts its shape', async () => {
    const ppvPayload = {
      streams: [
        {
          category: 'Football',
          streams: [
            {
              id: 5,
              name: 'Mexico vs. Canada',
              iframe: 'https://embedindia.st/embed/wc/mex-can',
              viewers: '1',
            },
          ],
        },
      ],
    };
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => (String(url).includes('ppv.st') ? ppvPayload : altPayload),
      }),
    );

    const { result } = renderHook(() => useStreams());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    // ppv match first, then the one alt event with a trusted url; Replays/24-7
    // categories and untrusted-only events are dropped.
    expect(result.current.matches.map((m) => m.name)).toEqual([
      'Mexico vs. Canada',
      'USA vs Bosnia-Herzegovina',
    ]);
    const alt = result.current.matches[1];
    expect(alt.iframe).toBe('https://vileembeds.pages.dev/embed/fox-usa');
    expect(alt.substreams).toEqual([
      {
        name: 'Telemundo',
        source_tag: 'Telemundo',
        iframe: 'https://vileembeds.pages.dev/embed/telemundo-usa',
      },
    ]);
    // 20:00 New York (EDT, UTC-4) → 00:00 UTC next day
    expect(alt.startsAt).toBe(Date.parse('2026-07-02T00:00:00Z') / 1000);
    expect(alt.slug).toBe('usa-vs-bosnia-herzegovina');
  });

  it('falls back to the alt source alone when ppv is down', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('ppv.st')
        ? Promise.reject(new TypeError('Network request failed'))
        : Promise.resolve({ ok: true, json: async () => altPayload }),
    );

    const { result } = renderHook(() => useStreams());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].name).toBe('USA vs Bosnia-Herzegovina');
  });

  it('aborts the in-flight request when refetch is called', async () => {
    let firstSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options: { signal?: AbortSignal }) => {
      if (!firstSignal) firstSignal = options?.signal;
      return new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          {
            once: true,
          },
        );
      });
    });

    const { result } = renderHook(() => useStreams());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(firstSignal?.aborted).toBe(false);

    act(() => {
      result.current.refetch();
    });
    expect(firstSignal?.aborted).toBe(true);
  });

  it('aborts the in-flight request on unmount', async () => {
    let firstSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options: { signal?: AbortSignal }) => {
      if (!firstSignal) firstSignal = options?.signal;
      return new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          {
            once: true,
          },
        );
      });
    });

    const { unmount } = renderHook(() => useStreams());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(firstSignal?.aborted).toBe(false);

    unmount();
    expect(firstSignal?.aborted).toBe(true);
  });
});
