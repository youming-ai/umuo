import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSitemapNews } from '../data/api';
import { renderSitemap, sitemapEntries } from '../sitemap';

export const prerender = false;

// Glue only. The paths and the XML live in src/sitemap.ts, which is pure and
// testable; the D1 lookup lives in src/data/api.ts behind the same KV cache as
// everything else. Keep it that way — this file cannot be unit-tested, because
// importing it pulls in 'cloudflare:workers'.
export const GET: APIRoute = async ({ locals }) => {
  const news = await getSitemapNews(env, locals.cfContext as ExecutionContext);
  return new Response(renderSitemap(sitemapEntries(news)), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
