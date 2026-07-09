import type { APIRoute } from 'astro';
import worker from '../../../worker/index';

export const prerender = false;

export const ALL: APIRoute = ({ request, locals }) => {
  const { env, ctx } = locals.runtime;
  return worker.fetch(
    request,
    env as Parameters<typeof worker.fetch>[1],
    ctx as Parameters<typeof worker.fetch>[2],
  );
};
