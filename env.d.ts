/// <reference path=".astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />
/// <reference path="./worker-configuration.d.ts" />

// Manual declarations for astro check, which does not fully merge the
// generated __BaseEnv_Env extends chain in worker-configuration.d.ts.
// Literal types must match wrangler.toml vars exactly.
declare namespace Cloudflare {
  interface Env {
    CACHE: KVNamespace;
    DB: D1Database;
  }
}

type Runtime = import('@astrojs/cloudflare').Runtime;

declare namespace App {
  interface Locals extends Runtime {}
}
