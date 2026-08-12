// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRUNE_CRON } from './retention';

// A Worker cannot read wrangler.toml at runtime, so the daily cron string is
// written twice: once as a trigger and once as PRUNE_CRON, which scheduled()
// compares controller.cron against. Nothing fails loudly if they drift — the
// sweep just stops recognising itself and runs a second full ingest instead.
// That is not hypothetical: the original duplicate "0 7 * * *" trigger did
// exactly that for weeks, because scheduled() ignored the controller entirely.

// cwd-relative: vitest's jsdom environment mangles import.meta.url schemes.
const raw = readFileSync(resolve(process.cwd(), 'wrangler.toml'), 'utf8');

// wrangler.toml is TOML, not JSON; the only field we need is the crons array
// in the [triggers] section. A regex is lighter than pulling in a TOML parser.
const cronsMatch = raw.match(/^crons\s*=\s*(\[[^\]]+\])/m);
const crons: string[] = cronsMatch ? (JSON.parse(cronsMatch[1]) as string[]) : [];

describe('cron wiring', () => {
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
