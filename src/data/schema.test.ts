// @vitest-environment node
// The one suite that executes real SQL.
//
// Every other test hands the data layer a `vi.fn()` that never parses a
// statement and always succeeds, so a renamed column, a missing index or a
// 20-vs-21 placeholder mismatch ships green — the same shape of gap that once
// let a /media route sit in an unreachable file while the suite passed. Here the
// migrations build a real SQLite database, a thin D1 shim puts it behind
// `env.DB`, and the production functions run their own statements against it.
//
// `node:sqlite` is unflagged from Node 22.13, and Bun implements it too; the
// floor is declared in package.json `engines`, because an older runtime cannot
// collect this file at all. `bun:sqlite` would avoid the floor but ships no
// types, and this repo typechecks its tests.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { storeArticle } from '../feeds/enrich';
import type { RawArticle } from '../feeds/types';
import type { Env } from './api';
import { getExploreFeed, getExploreFilters, getSitemapNews } from './api';
// Not re-exported by the facade: the legacy-redirect module is imported directly
// by its route, so this suite imports it the same way the route does.
import { serveArticleRedirect } from './article';

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of files) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8'));
  }
  // `articles.source_id` is a real foreign key, so a row cannot exist without
  // its source. (The stubbed tests never notice; this one does.)
  db.prepare(
    `INSERT INTO sources (id, kind, name, url, authority_score, enabled, created_at, updated_at)
     VALUES ('poche-explore', 'rss', 'Poche Explore', 'https://poche.app/explore/rss', 90, 1, ?, ?)`,
  ).run(PUBLISHED_AT, PUBLISHED_AT);
  return db;
}

/** The D1 surface the app actually uses (prepare/bind/all/first/run/batch). */
function envFor(db: DatabaseSync): Env {
  const prepare = (sql: string) => {
    const statement = db.prepare(sql);
    const api = {
      params: [] as unknown[],
      bind(...params: unknown[]) {
        api.params = params;
        return api;
      },
      async all() {
        return { results: statement.all(...(api.params as never[])) };
      },
      async first() {
        return (statement.get(...(api.params as never[])) ?? null) as never;
      },
      async run() {
        const result = statement.run(...(api.params as never[]));
        return { meta: { changes: Number(result.changes) } };
      },
    };
    return api;
  };
  return {
    DB: {
      prepare,
      // D1 runs a batch as one transaction, so a later failure leaves no earlier
      // write behind. `Promise.all` would let an ingest test observe partial
      // writes production can never produce.
      async batch(statements: { all(): Promise<unknown> }[]) {
        db.exec('BEGIN');
        try {
          const results: unknown[] = [];
          for (const statement of statements) results.push(await statement.all());
          db.exec('COMMIT');
          return results;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
    CACHE: { get: async () => null, put: async () => undefined },
  } as unknown as Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const PUBLISHED_AT = Date.parse('2026-09-10T09:00:00Z');

function seed(db: DatabaseSync, overrides: Record<string, unknown> = {}): void {
  const row = {
    id: 'f'.repeat(64),
    source_id: 'poche-explore',
    canonical_url: 'https://example.com/story',
    fingerprint: 'f'.repeat(64),
    title: 'A seeded story',
    title_norm: 'a seeded story',
    description: 'Teaser',
    ai_summary: 'Teaser',
    ai_blurb: 'Teaser',
    image_url: '',
    image_width: 0,
    image_height: 0,
    published_at: PUBLISHED_AT,
    fetched_at: PUBLISHED_AT,
    category: 'tools',
    article_type: 'link',
    is_on_topic: 1,
    quality_score: 90,
    freshness_score: 0,
    status: 'published',
    created_at: PUBLISHED_AT,
    updated_at: PUBLISHED_AT,
    ...overrides,
  };
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO articles (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...(Object.values(row) as never[]));
}

describe('migrations', () => {
  it('apply in order to an empty database', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    expect(() => migratedDatabase()).not.toThrow();
  });

  it('build the indexes the hot queries are planned against', () => {
    const db = migratedDatabase();
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    ).map((row) => row.name);
    // Not decoration: the feed's predicate and the ingest dedupe are planned
    // against these, and a migration that drops one silently turns a seek into
    // a scan.
    expect(indexes).toContain('idx_articles_published');
    expect(indexes).toContain('idx_articles_category');
    expect(indexes).toContain('idx_articles_source');
    // The ingest dedupe reads `WHERE title_norm IN (...)` every tick.
    expect(indexes).toContain('idx_articles_title_norm');
  });
});

describe('the explore queries run against the migrated schema', () => {
  it('returns a seeded published row through the real projection and mapper', async () => {
    const db = migratedDatabase();
    seed(db);
    const feed = await getExploreFeed({}, envFor(db), ctx);

    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      id: 'f'.repeat(64),
      title: 'A seeded story',
      url: 'https://example.com/story',
      category: 'tools',
      isVideo: false,
      qualityScore: 90,
      publishedAt: PUBLISHED_AT,
      // Computed at query time from published_at over a 72h window, so a row
      // this old floors at 0 — which is what proves the expression ran.
      freshnessScore: 0,
    });
    expect(feed.nextCursor).toBeNull();
  });

  it('excludes rows the feed must not show', async () => {
    const db = migratedDatabase();
    seed(db, {
      id: 'a'.repeat(64),
      fingerprint: 'a'.repeat(64),
      canonical_url: 'https://example.com/archived',
      status: 'archived',
    });
    seed(db, {
      id: 'b'.repeat(64),
      fingerprint: 'b'.repeat(64),
      canonical_url: 'https://example.com/off-topic',
      is_on_topic: 0,
    });
    const feed = await getExploreFeed({}, envFor(db), ctx);
    expect(feed.items).toHaveLength(0);
  });

  it('runs the filters aggregate', async () => {
    const db = migratedDatabase();
    seed(db);
    const filters = await getExploreFilters('', envFor(db), ctx);
    expect(filters.categories).toEqual([expect.objectContaining({ value: 'tools', count: 1 })]);
  });

  it('runs the sitemap aggregate and maps its timestamp', async () => {
    const db = migratedDatabase();
    seed(db);
    const { hubs } = await getSitemapNews(envFor(db), ctx);
    expect(hubs).toEqual([{ category: 'tools', lastmod: new Date(PUBLISHED_AT).toISOString() }]);
  });

  it('runs the legacy redirect lookup', async () => {
    const db = migratedDatabase();
    seed(db);
    const response = await serveArticleRedirect('f'.repeat(64), envFor(db));
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://example.com/story');
  });
});

describe('the D1 shim', () => {
  it('rolls a whole batch back when one statement fails', async () => {
    // D1's batch is transactional. If the shim were `Promise.all`, an ingest
    // test could observe a partial write that production can never produce —
    // and `ensureSources` writes its sources through `batch`.
    const db = migratedDatabase();
    const env = envFor(db) as unknown as { DB: { prepare(sql: string): unknown } };
    const insert = (id: string, name: string) =>
      (
        env.DB.prepare(
          `INSERT INTO sources (id, kind, name, url, authority_score, enabled, created_at, updated_at)
         VALUES (?, 'rss', ?, 'https://example.com/rss', 80, 1, ?, ?)`,
        ) as { bind(...params: unknown[]): unknown }
      ).bind(id, name, PUBLISHED_AT, PUBLISHED_AT);

    const statements = [
      insert('first', 'First'),
      // Same primary key: the second insert cannot succeed.
      insert('first', 'Duplicate'),
    ];
    await expect(
      (env.DB as unknown as { batch(s: unknown[]): Promise<unknown> }).batch(statements),
    ).rejects.toThrow();

    const count = db.prepare("SELECT COUNT(*) AS n FROM sources WHERE id = 'first'").get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });
});

describe('storeArticle', () => {
  const article: RawArticle = {
    sourceId: 'poche-explore',
    sourceName: 'Poche Explore',
    sourceAuthority: 90,
    category: 'Tools',
    title: 'A stored story',
    description: 'Teaser',
    url: 'https://example.com/stored',
    canonicalUrl: 'https://example.com/stored',
    imageUrl: '',
    imageWidth: 0,
    imageHeight: 0,
    publishedAt: PUBLISHED_AT,
    fetchedAt: PUBLISHED_AT,
    fingerprint: 'c'.repeat(64),
  };

  it('writes a row the feed can read back', async () => {
    // This is the placeholder-count assertion: 21 columns against 21 binds is
    // invisible to a stubbed `prepare`.
    const db = migratedDatabase();
    const env = envFor(db);
    await expect(storeArticle(env, article)).resolves.toBeUndefined();

    const feed = await getExploreFeed({}, env, ctx);
    expect(feed.items.map((item) => item.title)).toEqual(['A stored story']);
  });

  it('is idempotent on a repeated fingerprint', async () => {
    const db = migratedDatabase();
    const env = envFor(db);
    await storeArticle(env, article);
    await storeArticle(env, article);
    const count = db.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number };
    expect(count.n).toBe(1);
  });
});
