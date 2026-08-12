// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INDEXNOW_KEY } from './indexnow';

// IndexNow verifies ownership by fetching {origin}/{key}.txt and checking the
// body matches the key sent in the ping. The key lives in two places: this
// constant (src/feeds/indexnow.ts) and the public file (public/{key}.txt).
// Nothing fails loudly if they drift — search engines just silently reject
// every ping. Same hazard as PRUNE_CRON; same cure: a binding test.

const keyFile = resolve(process.cwd(), 'public', `${INDEXNOW_KEY}.txt`);

describe('IndexNow key binding', () => {
  it('is a valid key (8–128 hex characters)', () => {
    expect(INDEXNOW_KEY).toMatch(/^[0-9a-f]{8,128}$/);
  });

  it('has a matching verification file in public/', () => {
    expect(existsSync(keyFile), `expected ${keyFile} to exist`).toBe(true);
  });

  it('the file body matches the key constant', () => {
    const body = readFileSync(keyFile, 'utf8').trim();
    expect(body).toBe(INDEXNOW_KEY);
  });
});
