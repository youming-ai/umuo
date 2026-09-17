import type { Env } from './cache';

/** Legacy handler for the `/a/<id>` summary pages, which were removed.
 *
 *  The sitemap advertised every one of those URLs and readers bookmarked them,
 *  so removing the route without a replacement would 404 links that are still
 *  alive. The article rows are deliberately retained (archival is what keeps
 *  the dedupe guards), and each carries the canonical source URL — so the page
 *  is redirected there instead. A 301 tells search engines the content now
 *  lives at the publisher, which matches why the pages were removed.
 *
 *  Always answers something: 301 on a known id, 404 otherwise. */
export async function serveArticleRedirect(id: string, env: Env): Promise<Response> {
  if (!env.DB) return new Response('Not found', { status: 404 });

  try {
    const row = await env.DB.prepare('SELECT canonical_url FROM articles WHERE id = ?')
      .bind(id)
      .first<{ canonical_url: string }>();
    if (!row?.canonical_url) return new Response('Not found', { status: 404 });

    return new Response(null, {
      status: 301,
      headers: {
        location: row.canonical_url,
        // Bookmarks resolve through here repeatedly; let the browser cache the
        // answer rather than paying a D1 lookup each time.
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('[legacy article] lookup failed:', error);
    return new Response('Upstream unavailable', { status: 502 });
  }
}
