// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../data/api';
import { processNewsQueue } from './queue';
import type { ArticleEnrichment, RawArticle } from './types';

const storedArticleId = vi.hoisted(() => vi.fn());
const enrichBatch = vi.hoisted(() => vi.fn());
const storeEnrichedArticle = vi.hoisted(() => vi.fn());
vi.mock('./enrich', () => ({
  storedArticleId,
  enrichBatch,
  storeEnrichedArticle,
}));

const env = { DB: {} } as unknown as Env;

function message(id: string, attempts = 1) {
  return {
    body: { sourceId: id, fingerprint: id, title: id } as RawArticle,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

const run = (messages: ReturnType<typeof message>[]) =>
  processNewsQueue({ messages } as never, env);

describe('processNewsQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storedArticleId.mockResolvedValue(null);
    enrichBatch.mockImplementation(async (_e, articles: RawArticle[]) =>
      articles.map(() => ({ isFootball: true, tags: [] }) as unknown as ArticleEnrichment),
    );
    storeEnrichedArticle.mockResolvedValue({ id: 'x', status: 'stored' });
  });

  it('spends one enrichment call for the whole batch', async () => {
    const messages = [message('a'), message('b'), message('c')];
    await run(messages);

    expect(enrichBatch).toHaveBeenCalledTimes(1);
    expect(enrichBatch.mock.calls[0]![1]).toHaveLength(3);
    expect(messages.every((m) => m.ack.mock.calls.length === 1)).toBe(true);
  });

  it('drops duplicates before they reach the model', async () => {
    storedArticleId.mockImplementation(async (_db, a: RawArticle) =>
      a.fingerprint === 'b' ? 'existing-id' : null,
    );
    const [a, b, c] = [message('a'), message('b'), message('c')];
    await run([a, b, c]);

    // b is acked without ever being enriched — a duplicate costs nothing.
    expect(b.ack).toHaveBeenCalledOnce();
    expect(enrichBatch.mock.calls[0]![1].map((x: RawArticle) => x.fingerprint)).toEqual(['a', 'c']);
  });

  it('never calls the model when every message is a duplicate', async () => {
    storedArticleId.mockResolvedValue('existing-id');
    const messages = [message('a'), message('b')];
    await run(messages);

    expect(enrichBatch).not.toHaveBeenCalled();
    expect(messages.every((m) => m.ack.mock.calls.length === 1)).toBe(true);
  });

  it('retries the batch when enrichment is unreachable', async () => {
    enrichBatch.mockRejectedValue(new Error('LLM down'));
    const messages = [message('a', 2), message('b', 2)];
    await run(messages);

    expect(messages.every((m) => m.ack.mock.calls.length === 0)).toBe(true);
    expect(messages[0]!.retry).toHaveBeenCalledWith({ delaySeconds: 40 });
  });

  it('retries only the message whose write failed', async () => {
    storeEnrichedArticle
      .mockResolvedValueOnce({ id: 'a', status: 'stored' })
      .mockRejectedValueOnce(new Error('d1 down'))
      .mockResolvedValueOnce({ id: 'c', status: 'stored' });
    const [a, b, c] = [message('a'), message('b'), message('c')];
    await run([a, b, c]);

    expect(a.ack).toHaveBeenCalledOnce();
    expect(c.ack).toHaveBeenCalledOnce();
    expect(b.ack).not.toHaveBeenCalled();
    expect(b.retry).toHaveBeenCalledOnce();
  });

  it('pairs each enrichment with the article at the same index', async () => {
    enrichBatch.mockResolvedValue([
      { isFootball: true, tags: ['first'] },
      { isFootball: true, tags: ['second'] },
    ]);
    await run([message('a'), message('b')]);

    expect(storeEnrichedArticle.mock.calls[0]![1].fingerprint).toBe('a');
    expect(storeEnrichedArticle.mock.calls[0]![2].tags).toEqual(['first']);
    expect(storeEnrichedArticle.mock.calls[1]![1].fingerprint).toBe('b');
    expect(storeEnrichedArticle.mock.calls[1]![2].tags).toEqual(['second']);
  });

  it('isolates a poison article to its own retry without losing the batch', async () => {
    // enrichBatch returns null for article 'b' — the poison-article contract.
    // The other two articles must still be acked; only 'b' retries.
    enrichBatch.mockResolvedValue([
      { isFootball: true, tags: ['a'] },
      null,
      { isFootball: true, tags: ['c'] },
    ]);
    const [a, b, c] = [message('a'), message('b'), message('c')];
    await run([a, b, c]);

    expect(a.ack).toHaveBeenCalledOnce();
    expect(c.ack).toHaveBeenCalledOnce();
    expect(storeEnrichedArticle).toHaveBeenCalledTimes(2);
    expect(b.ack).not.toHaveBeenCalled();
    expect(b.retry).toHaveBeenCalledOnce();
  });
});
