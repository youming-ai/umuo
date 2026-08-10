import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveExploreRss } from '../data/api';

export const prerender = false;

// Global RSS 2.0 feed, served at /rss.xml via Astro's filename-as-route
// convention (same pattern as pages/sitemap.xml.ts). The per-comp variant
// lives at /[comp]/rss.xml and reuses the same `serveExploreRss` core.
//
// Why not /api/explore/rss? A reader polls a URL it stored six months ago;
// short, top-level paths survive client-side canonicalisation (NetNewsWire,
// Reeder both strip query strings on resubscribe). `/rss.xml` is what every
// other site settles on; the `.xml` extension gives HTTP-level sniffers a
// content-type hint and matches what readers type when guessing.
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
