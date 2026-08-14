import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getGoogleNewsSitemapArticles } from '../data/api';
import { renderGoogleNewsSitemap } from '../sitemap';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const articles = await getGoogleNewsSitemapArticles(env, locals.cfContext as ExecutionContext);
  return new Response(renderGoogleNewsSitemap(articles), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=1800',
    },
  });
};
