/// <reference types="@cloudflare/workers-types" />

// Manual declarations for the worker tsconfig, which does not include the
// root env.d.ts. Literal types must match wrangler.jsonc vars exactly.
declare namespace Cloudflare {
  interface Env {
    CACHE: KVNamespace;
    DB: D1Database;
    INGEST_QUEUE: Queue;
    ASSETS: Fetcher;
    LLM_MODEL: string;
    LLM_BASE_URL: string;
    LLM_API_KEY: string;
  }
}
