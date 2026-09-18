/// <reference path=".astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />
/// <reference path="./worker-configuration.d.ts" />

// Manual declarations for astro check, which does not fully merge the
// generated __BaseEnv_Env extends chain in worker-configuration.d.ts. They must
// match the bindings in wrangler.toml, which declares no [vars] at all.
// `ASSETS` is absent because nothing in `src/` reads it — the worker half
// declares it, and must, for its own tsconfig (see worker/env.d.ts).
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
