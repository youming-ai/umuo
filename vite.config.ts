/// <reference types="vitest" />

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { buildUrl, COMPETITIONS, seasonForDate } from './src/competitions';
import { assembleLeaders, LEADERS_BY_SPORT } from './src/leaders';
import { buildNewsUrl, newsParamsFromQuery } from './src/news';

// dev only: /api/<key>/leaders can't be a URL rewrite (it aggregates several
// upstream core.api requests into one Leader[]). Intercept it here and run the
// SAME assembleLeaders the Worker uses — no second implementation, no drift.
// No caching in dev (that's the Worker's job in prod; see worker/index.ts).
function leadersDevMiddleware(): import('vite').Plugin {
  return {
    name: 'leaders-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const m = url.pathname.match(/^\/api\/([^/]+)\/leaders$/);
        if (!m) return next();
        const comp = COMPETITIONS[m[1]];
        const map = comp && LEADERS_BY_SPORT[comp.sport];
        if (!comp || !map) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        try {
          const leaders = await assembleLeaders(globalThis.fetch, {
            sport: comp.sport,
            league: comp.league,
            season: seasonForDate(comp.sport, new Date()),
            type: map.type,
            category: map.category,
            topN: 15,
          });
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(leaders));
        } catch (err) {
          console.error('[vite] leaders middleware failed:', err);
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end('{"error":"leaders unavailable"}');
        }
      });
    },
  };
}

// dev only: /api/news lives on a DIFFERENT upstream host (now.core.api.espn.com)
// than the fixed proxy target, so it can't be a path rewrite. Intercept it here
// and fetch the whitelisted URL directly. No caching in dev (that's the Worker's
// job in prod; see worker/index.ts serveNews).
function newsDevMiddleware(): import('vite').Plugin {
  return {
    name: 'news-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        if (url.pathname !== '/api/news') return next();
        try {
          const upstream = await globalThis.fetch(
            buildNewsUrl(newsParamsFromQuery(url.searchParams)),
          );
          const body = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(body);
        } catch (err) {
          console.error('[vite] news middleware failed:', err);
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end('{"error":"news unavailable"}');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), leadersDevMiddleware(), newsDevMiddleware()],
  server: {
    allowedHosts: ['umuo.app', '.umuo.app'],
    // dev only: no Worker locally, so forward /api/<key>/* straight to ESPN, mirroring
    // the routes the KV-caching Worker serves in prod (see worker/index.ts).
    proxy: {
      '/api': {
        target: 'https://site.api.espn.com',
        changeOrigin: true,
        rewrite: (p) => {
          const [path, query = ''] = p.split('?');
          const m = path.match(/^\/api\/([^/]+)\/(scoreboard|standings|summary)$/);
          if (!m) return p;
          const comp = COMPETITIONS[m[1]];
          if (!comp) return p;
          const event = new URLSearchParams(query).get('event') ?? undefined;
          const full = buildUrl(comp, m[2] as 'scoreboard' | 'standings' | 'summary', event);
          const u = new URL(full);
          // ponytail: drops buildUrl's host because every competition is on
          // site.api.espn.com today (the fixed `target` above). If a future
          // comp's buildUrl returns a different host (e.g. core.api.espn.com),
          // derive the target per-request via the proxy `router` option instead.
          return u.pathname + u.search;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    fileParallelism: false,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react') || id.includes('/node_modules/react-dom')) {
            return 'react-vendor';
          }
        },
      },
    },
  },
});
