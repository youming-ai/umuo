/// <reference types="@cloudflare/workers-types" />

import { handle } from '@astrojs/cloudflare/handler';
import { ingestAllSources } from '../src/feeds/ingest';
import { PRUNE_CRON, pruneOldRecords } from '../src/feeds/retention';
import type { Env } from '../src/data/api';

const entrypoint: ExportedHandler<Env> = {
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
};

export default entrypoint;
