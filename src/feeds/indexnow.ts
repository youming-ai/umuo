import { SITE_ORIGIN, articlePath } from '../site';

/**
 * The IndexNow key — a static, non-secret value. Search engines verify
 * ownership by fetching `{SITE_ORIGIN}/{key}.txt` and checking the body
 * matches. The file lives at `public/{key}.txt` and is served as a static
 * asset. Generated once; changing it means updating both the key file and
 * every future ping.
 */
export const INDEXNOW_KEY = '7b4f8a2c3e1d9605f3a8c7e2b1d49603';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';

/** Build the `{SITE_ORIGIN}/a/{id}` URL for one article. */
export function articleUrl(id: string): string {
  return `${SITE_ORIGIN}${articlePath(id)}`;
}

/**
 * Notify IndexNow-participating search engines (Bing, Yandex, Naver, Seznam,
 * Yep) that the given URLs were created or updated. Fire-and-forget via
 * `ctx.waitUntil` — a failed ping is a missed notification, not data loss, so
 * it never blocks the queue handler or triggers a retry.
 *
 * IndexNow accepts up to 10 000 URLs per request; a queue batch carries 10.
 */
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
        // 200 = submitted, 202 = accepted for later processing. Anything else
        // is a config or key problem worth surfacing in logs.
        if (response.status !== 200 && response.status !== 202) {
          console.error(`[indexnow] ping returned ${response.status}`);
        }
      })
      .catch((error) => console.error('[indexnow] ping failed:', error)),
  );
}
