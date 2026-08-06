import type { Env } from '../data/api';
import { processArticle } from './enrich';
import type { RawArticle } from './types';

// Per message, not per batch: processArticle spends a Gemini call, so retrying
// the whole batch on one failure would re-bill every message that already
// succeeded. Retries are safe because processArticle short-circuits on an
// article whose canonical URL or fingerprint is already stored.
export async function processNewsQueue(batch: MessageBatch<RawArticle>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processArticle(env, message.body);
      message.ack();
    } catch (error) {
      console.error(`[queue] ${message.body?.sourceId ?? 'unknown'} failed:`, error);
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** message.attempts) });
    }
  }
}
