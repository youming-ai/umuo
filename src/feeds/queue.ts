import type { Env } from '../data/api';
import { enrichBatch, storeEnrichedArticle, storedArticleId } from './enrich';
import { articleUrl, notifyIndexNow } from './indexnow';
import type { ArticleEnrichment, RawArticle } from './types';

type QueueMessage = MessageBatch<RawArticle>['messages'][number];

/** Exponential backoff capped at 5 minutes. */
function retryDelay(message: QueueMessage) {
  return { delaySeconds: Math.min(300, 10 * 2 ** message.attempts) };
}

/** One LLM call per queue batch. Duplicates are dropped first (so they never
 *  reach the model); whatever survives goes out as a single interaction; each
 *  result is then written and acked individually. `enrichBatch` returns null
 *  for any article the model could not enrich — a null slot retries only its
 *  own message, so one consistently-failing story cannot keep the whole batch
 *  failing forever. Stored articles are pinged to IndexNow. */
export async function processNewsQueue(
  batch: MessageBatch<RawArticle>,
  env: Env,
  ctx?: ExecutionContext,
): Promise<void> {
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
    // Model unreachable — retry the whole batch.
    console.error('[queue] enrichment failed for the whole batch:', error);
    for (const { message } of pending) message.retry(retryDelay(message));
    return;
  }
  const storedUrls: string[] = [];

  for (const [index, { message, article }] of pending.entries()) {
    const enrichment = enrichments[index];
    if (!enrichment) {
      message.retry(retryDelay(message));
      continue;
    }
    try {
      const result = await storeEnrichedArticle(env, article, enrichment);
      message.ack();
      if (result.status === 'stored') {
        storedUrls.push(articleUrl(result.id));
      }
    } catch (error) {
      console.error(`[queue] ${article.sourceId} write failed:`, error);
      message.retry(retryDelay(message));
    }
  }

  if (ctx) notifyIndexNow(storedUrls, ctx);
}
