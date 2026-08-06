/// <reference types="@cloudflare/workers-types" />

// Secret bindings are supplied by `wrangler secret put` and therefore cannot
// be inferred from wrangler.jsonc.
declare namespace Cloudflare {
  interface Env {
    CACHE: KVNamespace;
    DB: D1Database;
    INGEST_QUEUE: Queue;
    ASSETS: Fetcher;
    GEMINI_MODEL: 'gemini-3.6-flash';
    FOOTBALL_NEWS_AGENT: DurableObjectNamespace<import('./entrypoint').FootballNewsAgent>;
    GEMINI_API_KEY: string;
  }
}
