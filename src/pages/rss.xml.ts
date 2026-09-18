import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveExploreRss } from '../data/api';

export const prerender = false;

// Global RSS 2.0 feed at /rss.xml (Astro's filename-as-route convention).
// Per-category variant lives at /[category]/rss.xml and reuses serveExploreRss.
// The feed composes its own absolute URLs from SITE_ORIGIN, so this route never
// consults the request host — the rendered document is cached host-independently.
export const GET: APIRoute = ({ locals }) =>
  serveExploreRss({}, env, locals.cfContext as ExecutionContext);
