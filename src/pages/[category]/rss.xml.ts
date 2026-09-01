import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { CATEGORIES } from '../../categories';
import { serveExploreRss } from '../../data/api';

export const prerender = false;

// Per-category RSS feed at /<category>/rss.xml. `category` is validated against
// the registry so an attacker can't pin arbitrary KV keys via /anything/rss.xml.
export const GET: APIRoute = ({ params, request, locals }) => {
  const category = params.category;
  if (typeof category !== 'string' || !Object.hasOwn(CATEGORIES, category)) {
    return new Response('Not found', { status: 404 });
  }
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  return serveExploreRss(
    { category },
    `${origin}/${category}/rss.xml`,
    origin,
    env,
    locals.cfContext as ExecutionContext,
  );
};
