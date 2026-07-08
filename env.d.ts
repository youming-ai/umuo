/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface Env {
	CACHE: KVNamespace;
	ASSETS: Fetcher;
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {}
}
