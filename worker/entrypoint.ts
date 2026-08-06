/// <reference types="@cloudflare/workers-types" />

import { handle } from '@astrojs/cloudflare/handler';
import { ingestAllSources } from '../src/feeds/ingest';
import { processNewsQueue } from '../src/feeds/queue';
import { FootballNewsAgent } from '../src/agents/football-news';
import type { RawArticle } from '../src/feeds/types';
import type { Env } from '../src/data/api';

// The Astro adapter owns normal HTTP/SSR routing. This custom entrypoint adds
// the Cloudflare event handlers that Astro's default entrypoint cannot expose:
// cron-triggered ingestion and Queue-triggered AI processing.
export { FootballNewsAgent };

const entrypoint: ExportedHandler<Env, RawArticle> = {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    const report = await ingestAllSources(env, ctx);
    console.log('[scheduled] football news ingest completed:', report);
  },

  async queue(batch, env, ctx) {
    void ctx;
    await processNewsQueue(batch, env);
  },
};

export default entrypoint;
