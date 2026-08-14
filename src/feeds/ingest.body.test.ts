import { describe, expect, it, vi } from 'vitest';
import { fillBody } from './readable';
import type { RawArticle } from './types';

function article(overrides: Partial<RawArticle> = {}): RawArticle {
  return {
    sourceId: 's',
    sourceName: 'S',
    sourceAuthority: 80,
    comp: null,
    title: 't',
    description: 'short teaser',
    url: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    imageUrl: '',
    imageWidth: 0,
    imageHeight: 0,
    publishedAt: 0,
    fetchedAt: 0,
    fingerprint: 'fp',
    ...overrides,
  };
}

describe('fillBody', () => {
  it('skips the fetch when the feed already syndicated a full body', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const a = article({ body: 'x'.repeat(500) });
    await fillBody(a);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(a.body).toBe('x'.repeat(500));
  });

  it('fetches and fills the body when the feed text is a short teaser', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '<html><head><title>t</title></head><body><article><p>' +
          'Haaland scored twice as City won. '.repeat(20) +
          '</p></article></body></html>',
        {
          headers: { 'content-type': 'text/html' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const a = article({ body: '' });
    await fillBody(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.body).toContain('Haaland scored twice');
  });

  it('leaves the body untouched on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })));
    const a = article({ body: '' });
    await fillBody(a);
    expect(a.body).toBe('');
  });
});
