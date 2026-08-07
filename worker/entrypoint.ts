/// <reference types="@cloudflare/workers-types" />

import { handle } from '@astrojs/cloudflare/handler';
import { ingestAllSources } from '../src/feeds/ingest';
import { processNewsQueue } from '../src/feeds/queue';
import type { RawArticle } from '../src/feeds/types';
import type { Env } from '../src/data/api';

// The Astro adapter owns normal HTTP/SSR routing. This custom entrypoint adds
// the Cloudflare event handlers that Astro's default entrypoint cannot expose:
// cron-triggered ingestion and Queue-triggered AI processing.
const entrypoint: ExportedHandler<Env, RawArticle> = {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    const report = await ingestAllSources(env, ctx);
    console.log('[scheduled] football news ingest completed:', report);
    // A source can fail every tick for a day without anything surfacing —
    // ESPN's six did, and only a hand-written source_health query found it.
    // Split to error level so Workers observability can alert on it.
    if (report.failed.length > 0) {
      console.error(
        `[scheduled] ${report.failed.length}/${report.sources} sources failed:`,
        report.failed.join(', '),
      );
    }
  },

  async queue(batch, env, ctx) {
    void ctx;
    await processNewsQueue(batch, env);
  },
};

export default entrypoint;
