/// <reference types="@cloudflare/workers-types" />

import { type Env, exploreQueryFromUrl, serveExplore, serveExploreFilters } from '../src/data/api';

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
        return serveExploreFilters(url.searchParams.get('category') ?? '', env, ctx);
      }
      // /media/* is deliberately absent: Astro only mounts this dispatcher at
      // /api/*, so it is unreachable for media. That route lives in
      // worker/entrypoint.ts, ahead of Astro.

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
