/// <reference path=".astro/types.d.ts" />
/// <reference types="astro/client" />

// `import { env } from 'cloudflare:workers'` types to `Cloudflare.Env`. Declare
// our bindings here so SSR pages get CACHE/ASSETS typed regardless of whether
// the CI-generated worker-configuration.d.ts is merged into this program.
declare namespace Cloudflare {
  interface Env {
    CACHE: KVNamespace;
    ASSETS: Fetcher;
    GEMINI_API_KEY: string;
  }
}

type Runtime = import('@astrojs/cloudflare').Runtime;

declare namespace App {
  interface Locals extends Runtime {}
}
