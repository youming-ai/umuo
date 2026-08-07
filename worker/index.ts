/// <reference types="@cloudflare/workers-types" />

import { exploreQueryFromUrl, type Env, serveExplore, serveExploreFilters } from '../src/data/api';

// Thin HTTP wrapper around the shared data layer (src/data/api.ts). The SWR
// primitives + composed serve* functions live there so Astro SSR pages can
// call them directly (env from 'cloudflare:workers' + Astro.locals.cfContext).
// This file only does URL parsing → serve* dispatch, and the ASSETS passthrough.

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
      if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
      return env.ASSETS.fetch(request); // static assets + SPA fallback
    } catch (err) {
      // Defense-in-depth: runCached already swallows KV-read hiccups, but any
      // other unexpected throw must not surface as an opaque workerd 1101.
      console.error('[worker] unhandled error:', err);
      return new Response('{"error":"internal"}', {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
  },
};
