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
      { role: 'user', content: expect.stringContaining('technology news site') },
    ]);
  });

  it('prompts the widened tech scope, not the old hardware-only gate', async () => {
    // Pins the classifier contract: phones and AI are on-topic categories,
    // with a worked on-topic example the model can anchor on. If these fail
    // after a prompt edit, the desk has narrowed again without meaning to.
    const fetchMock = vi.fn().mockResolvedValue(openAIResponse(enrichment));
    vi.stubGlobal('fetch', fetchMock);
    await enrichWithLLM('secret', BASE_URL, MODEL, article);

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages[0].content;
    expect(prompt).toContain('category=phones');
    expect(prompt).toContain('category=ai');
    expect(prompt).not.toContain('iPhone 18 rumor roundup: what to expect" → isOnTopic=false');
  });

  it('throws on missing API key', async () => {
    await expect(enrichWithLLM('', BASE_URL, MODEL, article)).rejects.toThrow('LLM_API_KEY');
  });
});
