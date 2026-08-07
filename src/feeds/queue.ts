import type { Env } from '../data/api';
import { enrichBatch, recordFailedRun, storeEnrichedArticle, storedArticleId } from './enrich';
import type { RawArticle } from './types';

/**
 * One Gemini call per queue batch instead of one per article.
 *
 * Order of business matters. Duplicates are dropped first, so they never reach
 * the model and never cost anything; whatever survives goes out as a single
 * interaction; then each result is written and acked individually. A message
 * that fails is retried on its own — retrying the batch would re-bill every
 * message in it that had already succeeded. Retries stay safe because a
 * re-delivered article is caught by the duplicate check above.
 */
export async function processNewsQueue(batch: MessageBatch<RawArticle>, env: Env): Promise<void> {
  if (!env.DB) throw new Error('D1 binding is required');

  const pending: { message: (typeof batch.messages)[number]; article: RawArticle }[] = [];
  for (const message of batch.messages) {
    try {
      if (await storedArticleId(env.DB, message.body)) {
        message.ack();
        continue;
      }
      pending.push({ message, article: message.body });
    } catch (error) {
      console.error(`[queue] ${message.body?.sourceId ?? 'unknown'} dedupe check failed:`, error);
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** message.attempts) });
    }
  }
  if (pending.length === 0) return;

  let enrichments: Awaited<ReturnType<typeof enrichBatch>>;
  try {
    enrichments = await enrichBatch(
      env,
      pending.map((item) => item.article),
    );
  } catch (error) {
    // Enrichment failed for the batch and for every per-article retry behind
    // it — almost always the model being unreachable, so retry them all.
    console.error('[queue] enrichment failed for the whole batch:', error);
    for (const { message } of pending) {
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** message.attempts) });
    }
    return;
  }

  for (const [index, { message, article }] of pending.entries()) {
    const enrichment = enrichments[index];
    if (!enrichment) {
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** message.attempts) });
      continue;
    }
    try {
      await storeEnrichedArticle(env, article, enrichment);
      message.ack();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown article write error';
      console.error(`[queue] ${article.sourceId} write failed:`, error);
      await recordFailedRun(env, article, detail).catch(() => {});
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** message.attempts) });
    }
  }
}
