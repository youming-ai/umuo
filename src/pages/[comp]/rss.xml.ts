import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { FOOTBALL_COMPETITIONS } from '../../competitions';
import { serveExploreRss } from '../../data/api';

export const prerender = false;

// Per-competition RSS feed, served at /<comp>/rss.xml. Pairs with the league
// page at /<comp> — both share the same URL prefix and the same scope label,
// so the feed and the page read as one bundle.
//
// `comp` is validated against the registry before dispatch so an attacker
// can't pin arbitrary KV keys by hitting `/anything/rss.xml`. The key whitelist
// is small (six leagues) and grows only by editing competitions.ts, which is
// a deliberate speed bump.
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
