import { describe, expect, it, vi } from 'vitest';
import { enrichWithGemini } from './gemini';
import type { RawArticle } from './types';

const article: RawArticle = {
  sourceId: 'bbc-football',
  sourceName: 'BBC Sport Football',
  sourceAuthority: 92,
  comp: 'eng.1',
  title: 'A football story',
  description: 'A factual football report.',
  url: 'https://example.com/story',
  canonicalUrl: 'https://example.com/story',
  imageUrl: '',
  publishedAt: Date.parse('2026-08-05T10:00:00Z'),
  fetchedAt: Date.parse('2026-08-05T10:01:00Z'),
  fingerprint: 'abc123',
};

describe('enrichWithGemini', () => {
  it('requests and validates structured JSON output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            isFootball: true,
            competition: 'eng.1',
            articleType: 'news',
            tags: ['premier-league'],
            summary: 'A factual football summary.',
            blurb: 'A concise football blurb.',
            qualityScore: 88,
          }),
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(enrichWithGemini('secret', 'gemini-3.6-flash', article)).resolves.toEqual({
      isFootball: true,
      competition: 'eng.1',
      articleType: 'news',
      tags: ['premier-league'],
      summary: 'A factual football summary.',
      blurb: 'A concise football blurb.',
      qualityScore: 88,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goog-api-key': 'secret' }),
      }),
    );
  });

  it('reads model output from the Interactions API steps shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          steps: [
            { type: 'thought', signature: 'hidden' },
            {
              type: 'model_output',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    isFootball: true,
                    competition: 'eng.1',
                    articleType: 'news',
                    tags: ['premier-league'],
                    summary: 'A factual football summary.',
                    blurb: 'A concise football blurb.',
                    qualityScore: 88,
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(enrichWithGemini('secret', 'gemini-3.6-flash', article)).resolves.toMatchObject({
      isFootball: true,
      competition: 'eng.1',
      articleType: 'news',
      tags: ['premier-league'],
    });
  });
});
