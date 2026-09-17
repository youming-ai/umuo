import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { serveArticleRedirect } from '../../data/article';

export const prerender = false;

/** Legacy `/a/<id>` links (bookmarks, old sitemap entries) redirect to the
 *  article's canonical source. The lookup lives in src/data/article. */
export const GET: APIRoute = ({ params }) =>
  serveArticleRedirect(params.id ?? '', env as Parameters<typeof serveArticleRedirect>[1]);

export const HEAD: APIRoute = GET;
