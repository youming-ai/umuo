/// <reference types="@cloudflare/workers-types" />

import { COMPETITIONS } from '../src/competitions';
import { type Env, json, serve, serveLeaders, serveSummary } from '../src/data/api';

// Thin HTTP wrapper around the shared data layer (src/data/api.ts). The SWR
// primitives + composed serve* functions live there so Astro SSR pages can
// call them directly with Astro.locals.runtime.env.CACHE. This file only does
// URL parsing → serve* dispatch, and the SPA-fallback passthrough to ASSETS.

export { json, serve, serveSummary, serveLeaders };
export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
      return serve(comp, resource as 'scoreboard' | 'standings' | 'news', env, ctx);
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request); // static assets + SPA fallback
  },
};
