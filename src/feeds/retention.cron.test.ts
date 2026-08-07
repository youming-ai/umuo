// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRUNE_CRON } from './retention';

// A Worker cannot read wrangler.jsonc at runtime, so the daily cron string is
// written twice: once as a trigger and once as PRUNE_CRON, which scheduled()
// compares controller.cron against. Nothing fails loudly if they drift — the
// sweep just stops recognising itself and runs a second full ingest instead.
// That is not hypothetical: the original duplicate "0 7 * * *" trigger did
// exactly that for weeks, because scheduled() ignored the controller entirely.

// cwd-relative: vitest's jsdom environment mangles import.meta.url schemes.
const raw = readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8');

/** wrangler.jsonc comments are all line-leading, and the file holds no URLs,
 *  so dropping those lines is enough to make it parseable. */
function parseJsonc(text: string): { triggers?: { crons?: string[] } } {
  return JSON.parse(
    text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n'),
  );
}

describe('cron wiring', () => {
  const crons = parseJsonc(raw).triggers?.crons ?? [];

  it('declares exactly the two schedules the handler knows how to route', () => {
    expect(crons).toHaveLength(2);
  });

  it('registers the sweep cron that PRUNE_CRON dispatches on', () => {
    expect(crons).toContain(PRUNE_CRON);
  });

  it('leaves exactly one other schedule, which the handler treats as ingest', () => {
    const ingest = crons.filter((cron) => cron !== PRUNE_CRON);
    expect(ingest).toEqual(['*/15 * * * *']);
  });

  it('guards against a second entry that would silently duplicate the ingest', () => {
    // Any cron that is not PRUNE_CRON falls through to ingestAllSources, so two
    // non-sweep entries means two full fans-out over every source.
    expect(crons.filter((cron) => cron !== PRUNE_CRON)).toHaveLength(1);
  });
});
