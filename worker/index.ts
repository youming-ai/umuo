/// <reference types="@cloudflare/workers-types" />

import { type Env, exploreQueryFromUrl, serveExplore, serveExploreFilters } from '../src/data/api';

// Hosts our feeds actually serve images from (derived from production D1).
// The proxy refuses anything else so it can't be abused as an open resizer.
const IMG_HOST_SUFFIXES = [
  '.bbci.co.uk', // BBC (ichef.bbci.co.uk)
  '.guim.co.uk', // Guardian
  '.minutemediacdn.com', // 90min
  '.epimg.net', // AS
  '.independent.co.uk',
  '.365dm.com', // Sky (e0/e1/e2.365dm.com)
  '.espncdn.com', // ESPN
  'espnmedia-cdn.akamaized.net',
];

function imgHostAllowed(src: string): boolean {
  try {
    const host = new URL(src).hostname.toLowerCase();
    return IMG_HOST_SUFFIXES.some((s) => host === s || host.endsWith(s));
  } catch {
    return false;
  }
}

/** Edge-resize a source image to the display width via Cloudflare Image
 *  Resizing (cf.image). Falls through to a plain fetch if Resizing isn't
 *  enabled on the zone — still correct, just no bandwidth win. */
async function serveImageProxy(url: URL): Promise<Response> {
  const src = url.searchParams.get('src');
  if (!src || !/^https:\/\//i.test(src) || !imgHostAllowed(src)) {
    return new Response('Not found', { status: 404 });
  }
  const width = Math.min(1200, Math.max(64, Number(url.searchParams.get('w')) || 800));
  try {
    const upstream = await fetch(new URL(src), {
      cf: { image: { width, quality: 78 } },
    });
    if (!upstream.ok || !upstream.body) return new Response('Not found', { status: 404 });
    const headers = new Headers(upstream.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('CDN-Cache-Control', 'public, max-age=31536000');
    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    console.error('[img] proxy failed for', src, err);
    return new Response('Not found', { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/explore') {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        return serveExplore(exploreQueryFromUrl(url), env, ctx);
      }
      if (url.pathname === '/api/explore/filters') {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        return serveExploreFilters(url.searchParams.get('comp') ?? '', env, ctx);
      }
      if (url.pathname === '/api/img') {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        return serveImageProxy(url);
      }
      if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
      return env.ASSETS.fetch(request); // static assets + SPA fallback
    } catch (err) {
      console.error('[worker] unhandled error:', err);
      return new Response('{"error":"internal"}', {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
  },
};
