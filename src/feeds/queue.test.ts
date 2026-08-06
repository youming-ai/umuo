// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../data/api';
import { processNewsQueue } from './queue';
import type { RawArticle } from './types';

const processArticle = vi.hoisted(() => vi.fn());
vi.mock('./enrich', () => ({ processArticle }));

function message(id: string, attempts = 1) {
  return {
    body: { sourceId: id, fingerprint: id } as RawArticle,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe('processNewsQueue', () => {
  beforeEach(() => {
    processArticle.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('acks each message it processes', async () => {
    processArticle.mockResolvedValue({ id: 'a', status: 'stored' });
    const messages = [message('a'), message('b')];
    await processNewsQueue({ messages } as never, {} as Env);

    expect(processArticle).toHaveBeenCalledTimes(2);
    expect(messages.every((m) => m.ack.mock.calls.length === 1)).toBe(true);
  });

  it('retries only the failing message, leaving its neighbours acked', async () => {
    processArticle
      .mockResolvedValueOnce({ id: 'a', status: 'stored' })
      .mockRejectedValueOnce(new Error('gemini down'))
      .mockResolvedValueOnce({ id: 'c', status: 'stored' });
    const [a, b, c] = [message('a'), message('b', 3), message('c')];
    await processNewsQueue({ messages: [a, b, c] } as never, {} as Env);

    expect(a.ack).toHaveBeenCalledOnce();
    expect(c.ack).toHaveBeenCalledOnce();
    expect(b.ack).not.toHaveBeenCalled();
    // Backoff grows with attempts and is capped at five minutes.
    expect(b.retry).toHaveBeenCalledWith({ delaySeconds: 80 });
  });

  it('caps the retry backoff at 300s', async () => {
    processArticle.mockRejectedValue(new Error('still down'));
    const m = message('a', 20);
    await processNewsQueue({ messages: [m] } as never, {} as Env);

    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });
});
