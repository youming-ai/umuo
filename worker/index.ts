/// <reference types="@cloudflare/workers-types" />

import { COMPETITIONS, type Resource } from '../src/competitions';
import { type Env, serve, serveLeaders, serveSummary } from '../src/data/api';

// Thin HTTP wrapper around the shared data layer (src/data/api.ts). The SWR
// primitives + composed serve* functions live there so Astro SSR pages can
// call them directly (env from 'cloudflare:workers' + Astro.locals.cfContext).
// This file only does URL parsing → serve* dispatch, and the ASSETS passthrough.

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const m = url.pathname.match(/^\/api\/([^/]+)\/(scoreboard|standings|summary|leaders|news)$/);
      if (m) {
        if (!Object.hasOwn(COMPETITIONS, m[1])) return new Response('Not found', { status: 404 });
        const comp = COMPETITIONS[m[1]];
        const resource = m[2];
        if (resource === 'summary') {
          return serveSummary(comp, url.searchParams.get('event') ?? '', env, ctx);
        }
        if (resource === 'leaders') {
          return serveLeaders(comp, env, ctx);
        }
        return serve(comp, resource as Resource, env, ctx);
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
