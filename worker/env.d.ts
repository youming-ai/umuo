/// <reference types="@cloudflare/workers-types" />

// Manual declarations for the worker tsconfig, which does not include the root
// env.d.ts. They must match the bindings in wrangler.toml (no [vars] exist).
// `ASSETS` is here because this half is what would touch it — though since /api
// only, nothing in worker/ does any more; Astro's adapter does.
declare namespace Cloudflare {
  interface Env {
    CACHE: KVNamespace;
    DB: D1Database;
    ASSETS: Fetcher;
  }
}
