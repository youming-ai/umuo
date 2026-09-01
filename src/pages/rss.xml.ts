import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveExploreRss } from '../data/api';

export const prerender = false;

// Global RSS 2.0 feed at /rss.xml (Astro's filename-as-route convention).
// Per-category variant lives at /[category]/rss.xml and reuses serveExploreRss.
export const GET: APIRoute = ({ request, locals }) => {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  return serveExploreRss(
    {},
    `${origin}/rss.xml`,
    origin,
    env,
    locals.cfContext as ExecutionContext,
  );
};
