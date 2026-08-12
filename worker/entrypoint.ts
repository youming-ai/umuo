/// <reference types="@cloudflare/workers-types" />

import { handle } from '@astrojs/cloudflare/handler';
import { ingestAllSources } from '../src/feeds/ingest';
import { processNewsQueue } from '../src/feeds/queue';
import { PRUNE_CRON, pruneOldRecords } from '../src/feeds/retention';
import type { RawArticle } from '../src/feeds/types';
import type { Env } from '../src/data/api';

const entrypoint: ExportedHandler<Env, RawArticle> = {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (controller.cron === PRUNE_CRON) {
      await pruneOldRecords(env);
      return;
    }

    const report = await ingestAllSources(env, ctx);
    // Surfacing failed sources at error level so observability can alert. A
    // source can fail every tick for a day without anything else noticing.
    if (report.failed.length > 0) {
      console.error(
        `[scheduled] ${report.failed.length}/${report.sources} sources failed:`,
        report.failed.join(', '),
      );
    }
  },

  async queue(batch, env, ctx) {
    await processNewsQueue(batch, env, ctx);
  },
};

export default entrypoint;
