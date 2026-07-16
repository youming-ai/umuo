import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import worker from '../../../worker/index';

export const prerender = false;

export const ALL: APIRoute = ({ request, locals }) => {
  return worker.fetch(
    request,
    env as Parameters<typeof worker.fetch>[1],
    locals.cfContext as Parameters<typeof worker.fetch>[2],
  );
};
