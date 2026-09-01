import { describe, expect, it, vi } from 'vitest';
import { enrichWithLLM } from './llm';
import type { RawArticle } from './types';

const article: RawArticle = {
  sourceId: 'toms-hardware',
  sourceName: "Tom's Hardware",
  sourceAuthority: 92,
  category: 'gpu',
  title: 'A hardware story',
  description: 'A factual hardware report.',
  url: 'https://example.com/story',
  canonicalUrl: 'https://example.com/story',
  imageUrl: '',
  imageWidth: 0,
  imageHeight: 0,
  publishedAt: Date.parse('2026-08-05T10:00:00Z'),
  fetchedAt: Date.parse('2026-08-05T10:01:00Z'),
  fingerprint: 'abc123',
};

const enrichment = {
  isOnTopic: true,
  category: 'gpu',
  articleType: 'news',
  tags: ['gpu'],
  summary: 'A factual hardware summary.',
  blurb: 'A concise hardware blurb.',
  qualityScore: 88,
};

const BASE_URL = 'https://api.b.ai/v1';
const MODEL = 'deepseek-v4-flash';

function openAIResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status: 200 },
  );
}

describe('enrichWithLLM', () => {
  it('requests and validates structured JSON output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAIResponse(enrichment));
    vi.stubGlobal('fetch', fetchMock);

    await expect(enrichWithLLM('secret', BASE_URL, MODEL, article)).resolves.toEqual(enrichment);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/chat/completions`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
    );
  });

  it('sends response_format json_object', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAIResponse(enrichment));
    vi.stubGlobal('fetch', fetchMock);

    await enrichWithLLM('secret', BASE_URL, MODEL, article);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.model).toBe(MODEL);
    expect(body.messages).toEqual([
      { role: 'user', content: expect.stringContaining('PC hardware and peripherals news site') },
    ]);
  });

  it('throws on missing API key', async () => {
    await expect(enrichWithLLM('', BASE_URL, MODEL, article)).rejects.toThrow('LLM_API_KEY');
  });
});
