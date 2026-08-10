import type { Env } from '../data/api';
import { enrichBatch, storeEnrichedArticle, storedArticleId } from './enrich';
import type { ArticleEnrichment, RawArticle } from './types';

type QueueMessage = MessageBatch<RawArticle>['messages'][number];

/** Exponential backoff capped at 5 minutes, same formula for every retry site. */
function retryDelay(message: QueueMessage) {
  return { delaySeconds: Math.min(300, 10 * 2 ** message.attempts) };
}

/**
 * One Gemini call per queue batch instead of one per article.
 *
 * Order of business matters. Duplicates are dropped first, so they never reach
 * the model and never cost anything; whatever survives goes out as a single
 * interaction; then each result is written and acked individually. A message
 * that fails is retried on its own — retrying the batch would re-bill every
 * message in it that had already succeeded. Retries stay safe because a
 * re-delivered article is caught by the duplicate check above.
 *
 * Poison-article isolation: `enrichBatch` returns null for any article the
 * model could not enrich (in the batch path via a length mismatch, in the
 * per-article fallback via a try/catch). A null slot retries only its own
 * message, so one consistently-failing story can no longer drag the whole
 * batch to the DLQ.
 */
export async function processNewsQueue(batch: MessageBatch<RawArticle>, env: Env): Promise<void> {
  if (!env.DB) throw new Error('D1 binding is required');

  const pending: { message: QueueMessage; article: RawArticle }[] = [];
  for (const message of batch.messages) {
    try {
      if (await storedArticleId(env.DB, message.body)) {
        message.ack();
        continue;
      }
      pending.push({ message, article: message.body });
    } catch (error) {
      console.error(`[queue] ${message.body?.sourceId ?? 'unknown'} dedupe check failed:`, error);
      message.retry(retryDelay(message));
    }
  }
  if (pending.length === 0) return;

  let enrichments: (ArticleEnrichment | null)[];
  try {
    enrichments = await enrichBatch(
      env,
      pending.map((item) => item.article),
    );
  } catch (error) {
    // Enrichment failed for the whole batch — almost always the model being
    // unreachable, so retry them all.
    console.error('[queue] enrichment failed for the whole batch:', error);
    for (const { message } of pending) message.retry(retryDelay(message));
    return;
  }

  for (const [index, { message, article }] of pending.entries()) {
    const enrichment = enrichments[index];
    if (!enrichment) {
      message.retry(retryDelay(message));
      continue;
    }
    try {
      await storeEnrichedArticle(env, article, enrichment);
      message.ack();
    } catch (error) {
      console.error(`[queue] ${article.sourceId} write failed:`, error);
      message.retry(retryDelay(message));
    }
  }
}
