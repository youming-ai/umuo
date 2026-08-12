import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { FOOTBALL_COMPETITIONS } from '../../competitions';
import { serveExploreRss } from '../../data/api';

export const prerender = false;

// Per-competition RSS feed at /<comp>/rss.xml. `comp` is validated against
// the registry so an attacker can't pin arbitrary KV keys via /anything/rss.xml.
export const GET: APIRoute = ({ params, request, locals }) => {
  const comp = params.comp;
  if (typeof comp !== 'string' || !Object.hasOwn(FOOTBALL_COMPETITIONS, comp)) {
    return new Response('Not found', { status: 404 });
  }
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  return serveExploreRss(
    { comp },
    `${origin}/${comp}/rss.xml`,
    origin,
    env,
    locals.cfContext as ExecutionContext,
  );
};
