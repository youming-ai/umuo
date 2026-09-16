import { SITE_ORIGIN } from './site';

// The upstream feed hosts some of its images on its own CDN. Those URLs would
// otherwise appear in card markup, the island's hydration payload, the RSS,
// and og:image — every one of them naming the upstream origin. Images on that
// host are therefore served from ours through the `/media/<file>` route.
//
// Only that one origin is proxied, and only its storage ids; everything else is
// passed through untouched.
export const UPSTREAM_MEDIA_ORIGIN = 'https://cloud.poche.app';

const UPSTREAM_MEDIA_PATH = '/api/storage/';

/** Public path prefix served by `serveMedia`. */
export const MEDIA_PATH = '/media/';

/** Upstream storage ids look like a UUID. The route accepts a file name and
 *  never a URL, so this pattern is what stops `/media/` from becoming an open
 *  proxy: no absolute URLs, no `..`, no other host, no query string. */
const MEDIA_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The upstream storage id behind `url`, or null when it is not ours to proxy. */
export function mediaFile(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== UPSTREAM_MEDIA_ORIGIN) return null;
    if (!parsed.pathname.startsWith(UPSTREAM_MEDIA_PATH)) return null;
    const file = parsed.pathname.slice(UPSTREAM_MEDIA_PATH.length);
    return MEDIA_FILE_RE.test(file) ? file : null;
  } catch {
    return null;
  }
}

/** Whether `url` points at the proxied origin, whatever its path. */
function isUpstreamHost(url: string): boolean {
  try {
    return new URL(url).origin === UPSTREAM_MEDIA_ORIGIN;
  } catch {
    return false;
  }
}

/** Rewrite an upstream-hosted image to our own origin. Absolute on purpose —
 *  og:image and JSON-LD both need a full URL, and this value reaches markup,
 *  the island payload, and the RSS alike.
 *
 *  A third-party image is returned untouched. An unrecognised URL *on the
 *  proxied origin* is dropped instead of passed through: the whole point of
 *  this module is that the upstream host never reaches markup, so silently
 *  forwarding a path shape we do not recognise would defeat it. A missing
 *  image is the cheaper failure, and today no such URL exists. */
export function proxiedImageUrl(url: string): string {
  const file = mediaFile(url);
  if (file) return `${SITE_ORIGIN}${MEDIA_PATH}${file}`;
  return isUpstreamHost(url) ? '' : url;
}

/** Handle a request for `/media/<file>`, or return null when the path is not
 *  ours so the caller can continue to its normal routing.
 *
 *  This is called from `worker/entrypoint.ts` *before* Astro's handler. Astro
 *  only mounts the worker dispatcher at `/api/*` (`src/pages/api/[...route].ts`),
 *  so a `/media/` request that reached Astro would match no page and fall
 *  through to ASSETS, 404ing every proxied image. Keep the call there. */
export function mediaRequest(request: Request, url: URL): Promise<Response> | null {
  if (!url.pathname.startsWith(MEDIA_PATH)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Promise.resolve(new Response('Method not allowed', { status: 405 }));
  }

  let file: string;
  try {
    file = decodeURIComponent(url.pathname.slice(MEDIA_PATH.length));
  } catch {
    // Malformed percent-encoding (`/media/%`, `/media/%E0%A4%A`) is client
    // input, not a server fault. Without this the URIError escapes to the
    // entrypoint's catch-all and becomes a 500 plus an error log line.
    return Promise.resolve(new Response('Bad request', { status: 400 }));
  }

  const served = serveMedia(file);
  if (request.method !== 'HEAD') return served;
  // HTTP requires a HEAD response to carry the headers of the equivalent GET
  // and no body, so the relayed body is dropped rather than sent.
  return served.then(
    (response) => new Response(null, { status: response.status, headers: response.headers }),
  );
}

/** The upstream URL for a `/media/<file>` request, or null when `file` is not a
 *  storage id. Callers must treat null as 404 — never as "fetch it anyway". */
export function upstreamMediaUrl(file: string): string | null {
  return MEDIA_FILE_RE.test(file) ? `${UPSTREAM_MEDIA_ORIGIN}${UPSTREAM_MEDIA_PATH}${file}` : null;
}

/** Stream one proxied image. The upstream body is relayed rather than buffered
 *  so a large image never has to be held whole, and the long `max-age` plus the
 *  edge cache keeps repeat views off the upstream entirely. */
export async function serveMedia(file: string): Promise<Response> {
  const upstream = upstreamMediaUrl(file);
  if (!upstream) return new Response('Not found', { status: 404 });

  try {
    const response = await fetch(upstream, {
      cf: { cacheEverything: true, cacheTtl: 86_400 },
    });
    // `fetch` follows redirects by default, which would let the relayed bytes
    // come from a host we did not pin. A same-origin redirect is fine; anything
    // else is refused rather than relayed blind. Guarded on `redirected` so the
    // common no-redirect path never parses a URL.
    if (response.redirected && new URL(response.url).origin !== UPSTREAM_MEDIA_ORIGIN) {
      return new Response('Upstream unavailable', { status: 502 });
    }
    // 404 is the upstream saying the file is gone — a permanent answer, and the
    // one worth caching as such. Anything else non-ok (5xx, 429) is transient,
    // so it must not be reported as a missing image.
    if (response.status === 404) return new Response('Not found', { status: 404 });
    if (!response.ok) return new Response('Upstream unavailable', { status: 502 });
    return new Response(response.body, {
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
        'cache-control': 'public, max-age=86400, immutable',
      },
    });
  } catch (error) {
    console.error('[media] upstream fetch failed:', error);
    return new Response('Upstream unavailable', { status: 502 });
  }
}
