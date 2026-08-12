import { SITE_ORIGIN, articlePath } from '../site';

/** Static, non-secret key. Search engines verify ownership by fetching
 *  `{SITE_ORIGIN}/{key}.txt` and checking the body matches. */
export const INDEXNOW_KEY = '7b4f8a2c3e1d9605f3a8c7e2b1d49603';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';

/** Build the `{SITE_ORIGIN}/a/{id}` URL for one article. */
export function articleUrl(id: string): string {
  return `${SITE_ORIGIN}${articlePath(id)}`;
}

/** Notify IndexNow-participating search engines of new/updated URLs. Fire-
 *  and-forget via `ctx.waitUntil` — a failed ping is a missed notification,
 *  not data loss. Batches cap at 10 000; a queue batch carries 10. */
export function notifyIndexNow(urls: string[], ctx: ExecutionContext): void {
  if (urls.length === 0) return;
  ctx.waitUntil(
    fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: SITE_ORIGIN.replace('https://', ''),
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
    })
      .then((response) => {
        // 200 submitted, 202 accepted. Anything else is a config/key problem.
        if (response.status !== 200 && response.status !== 202) {
          console.error(`[indexnow] ping returned ${response.status}`);
        }
      })
      .catch((error) => console.error('[indexnow] ping failed:', error)),
  );
}
