/// <reference types="@cloudflare/workers-types" />

import { handle } from '@astrojs/cloudflare/handler';
import type { Env } from '../src/data/api';
import { ingestAllSources } from '../src/feeds/ingest';
import { PRUNE_CRON, pruneOldRecords } from '../src/feeds/retention';
import { mediaRequest } from '../src/media';

const entrypoint: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    // `/media/<id>` is resolved here, ahead of Astro: it is a binary relay, and
    // Astro only mounts the worker dispatcher at `/api/*`, so a media request
    // that reached it would match no route and 404 against ASSETS.
    const media = mediaRequest(request, new URL(request.url));
    if (media) return media;
    return handle(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    // Logged with which cron failed, then rethrown: a scheduled event that
    // rejects follows the platform's retry path, and swallowing it here would
    // report a successful invocation for a tick that never ran. Per-source and
    // per-article failures are already handled inside; this covers the setup
    // failure that would otherwise escape (a D1 error while ensuring sources,
    // most likely).
    try {
      await runScheduled(controller, env, ctx);
    } catch (error) {
      console.error(`[scheduled] ${controller.cron} failed:`, error);
      throw error;
    }
  },
};

/** The loop body, split out so the handler can report a failure instead of
 *  letting it escape into a silent missed tick. */
async function runScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
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
  if (report.uncategorized > 0) {
    // Name the values: a category missing from src/categories.ts is stored as
    // NULL and never reaches a hub, so an upstream taxonomy change is only
    // visible here until the registry is updated to match the feed.
    console.warn(
      `[scheduled] ${report.uncategorized}/${report.fetched} fetched articles had no registered category:`,
      report.unmappedCategories.join(', '),
    );
  }
}

export default entrypoint;
