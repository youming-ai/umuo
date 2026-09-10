/// <reference types="@cloudflare/workers-types" />

// Manual declarations for the worker tsconfig, which does not include the
// root env.d.ts. Literal types must match wrangler.toml vars exactly.
declare namespace Cloudflare {
  interface Env {
    CACHE: KVNamespace;
    DB: D1Database;
    ASSETS: Fetcher;
  }
}
