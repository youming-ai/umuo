import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSitemapNews } from '../data/api';
import { renderSitemap, sitemapEntries } from '../sitemap';

export const prerender = false;

// Glue only. The paths + XML live in src/sitemap.ts (pure, testable); the D1
// lookup lives in src/data/api.ts behind the same KV cache.
export const GET: APIRoute = async ({ locals }) => {
  const data = await getSitemapNews(env, locals.cfContext as ExecutionContext);
  return new Response(renderSitemap(sitemapEntries(data)), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
