# Astro Skeleton (Migration Plan 1 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Astro build + SSR shell in-place, mount the entire existing React SPA as one catch-all island, and route `/api/*` through the existing worker — so the site runs uninterrupted on Astro/Cloudflare while later plans peel pages into real SSR.

**Architecture:** Astro (Cloudflare adapter) replaces Vite as the build/dev/deploy tool in the same repo. A catch-all page mounts `<App client:only="react">` (SPA unchanged, client-rendered for now — SSR/SEO comes in later per-page plans). A catch-all Astro API route forwards `/api/*` to the existing `worker/index.ts` default export, reusing all current caching/adapters verbatim. Layout carries the current `index.html` head.

**Tech Stack:** Astro 5, @astrojs/react, @astrojs/cloudflare, React 18, Tailwind v3 (unchanged, via PostCSS), TypeScript, Vitest, npm.

## Global Constraints

- **Package manager: npm** (unchanged — do NOT switch to bun in this plan; that's a separate decision).
- **Tailwind stays v3** (unchanged — keep `tailwind.config.js` + `postcss.config.js`; do NOT upgrade to v4 in this plan).
- **This plan does NOT extract the data layer or convert any page to SSR.** The SPA stays whole, client-rendered, behind a catch-all island; `/api/*` reuses the existing worker as-is. (Data-layer extraction and per-page SSR are later plans, per the design spec §4.)
- Runtime: Cloudflare Workers; KV binding stays named **`CACHE`** (existing id `1ec03cc00a6d43068e3d7c4473973fd3`).
- Biome unchanged (`biome.json`; `.astro` files are not linted by Biome — fine).
- The full existing Vitest suite (349 tests) must stay green after the migration.
- Deliverable = the site builds with `astro build` and runs with `npm run dev`, serving every existing route (SPA) plus a working `/api/*`.

## File Structure

- Create: `astro.config.mjs` — Astro config (react + cloudflare adapter + platformProxy for dev bindings)
- Create: `src/layouts/Layout.astro` — the HTML document (head from `index.html` + `<slot/>`)
- Create: `src/pages/[...all].astro` — catch-all page mounting the SPA island
- Create: `src/components/AppIsland.tsx` — thin wrapper: providers + `<App/>` (the island entry)
- Create: `src/pages/api/[...route].ts` — catch-all API route forwarding to `worker/index.ts`
- Create: `env.d.ts` — Astro + Cloudflare runtime types
- Modify: `package.json` — deps + scripts
- Modify: `tsconfig.json` — extend Astro's strict base, keep path/JSX settings
- Modify: `wrangler.jsonc` — point `main` at Astro's emitted worker
- Delete: `index.html`, `src/main.tsx`, `vite.config.ts` (Astro replaces them; the leaders/news dev middleware in vite.config is no longer needed — the worker handles those routes)
- Keep untouched: `worker/index.ts`, `tsconfig.worker.json`, all of `src/` except the entry files above, `tailwind.config.js`, `postcss.config.js`, `src/index.css`.

---

### Task 1: Astro install + config (build tooling swap)

**Files:**
- Modify: `package.json`
- Create: `astro.config.mjs`, `env.d.ts`
- Modify: `tsconfig.json`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: a buildable Astro project. Later tasks add pages/routes. `astro.config.mjs` exports the config with `@astrojs/react` + `@astrojs/cloudflare` (platformProxy enabled for dev bindings).

- [ ] **Step 1: Install Astro dependencies**

Run:
```bash
npm install astro@^5 @astrojs/react@^4 @astrojs/cloudflare@^12
npm install -D @astrojs/check
```
(Keep existing `react`, `react-dom`, `@vitejs/plugin-react` — Astro's react integration uses them. `@astrojs/check` powers `astro check` for typechecking `.astro` files.)

- [ ] **Step 2: Create `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

// Tailwind v3 is applied via the existing postcss.config.js (Astro picks up
// PostCSS automatically) — no @astrojs/tailwind needed. Data layer + per-page
// SSR come in later plans; for now the SPA is one client-only island and the
// only server route is /api (prerender=false).
export default defineConfig({
  adapter: cloudflare({
    platformProxy: { enabled: true }, // dev: miniflare provides CACHE (KV) via Astro.locals.runtime.env
  }),
  integrations: [react()],
});
```

- [ ] **Step 3: Create `env.d.ts`** (Astro + Cloudflare runtime types)

```ts
/// <reference types="astro/client" />

type Env = {
  CACHE: KVNamespace;
  ASSETS: Fetcher;
};

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
```

- [ ] **Step 4: Update `tsconfig.json`** to extend Astro's strict base while keeping the existing JSX/module settings

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["DOM", "DOM.Iterable", "ES2024"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src", "env.d.ts", "worker", "worker-configuration.d.ts"],
  "exclude": ["dist"]
}
```
(Dropped `vite.config.ts` from `include` — it's being deleted. Added `worker` so the worker source still type-checks under the app config now that `tsconfig.worker.json`'s role narrows; `tsconfig.worker.json` stays as the worker-only strict check.)

- [ ] **Step 5: Update `package.json` scripts**

Replace the `scripts` block with:
```json
  "scripts": {
    "dev": "astro dev",
    "build": "astro check && tsc -p tsconfig.worker.json && astro build",
    "preview": "astro preview",
    "typecheck": "astro check && tsc -p tsconfig.worker.json",
    "test": "vitest",
    "lint": "biome lint .",
    "lint:fix": "biome lint --write .",
    "format": "biome format --write .",
    "format:check": "biome format ."
  }
```

- [ ] **Step 6: Update `wrangler.jsonc`** — point `main` at Astro's emitted worker, keep KV + assets

Change `"main": "worker/index.ts"` to `"main": "./dist/_worker.js/index.js"`, and set assets directory to `./dist`. Keep the `CACHE` kv_namespaces entry and `compatibility_date`. Add `"compatibility_flags": ["nodejs_compat"]`. The `assets` binding block becomes:
```jsonc
  "assets": { "directory": "./dist", "binding": "ASSETS" },
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [{ "binding": "CACHE", "id": "1ec03cc00a6d43068e3d7c4473973fd3" }]
```
(Remove `not_found_handling` — Astro's routing + the catch-all page handle SPA fallback now.)

- [ ] **Step 7: Verify the project builds**

Run: `npm run build`
Expected: `astro check` passes (0 errors), `tsc -p tsconfig.worker.json` clean, `astro build` emits `dist/_worker.js/`. (There are no pages yet, so Astro may warn about no routes — acceptable at this step; Task 3 adds pages. If `astro build` hard-fails on zero routes, proceed to Task 2/3 first and run this verification at the end of Task 3 instead — note which happened in the report.)

- [ ] **Step 8: Commit**

```bash
git add package.json astro.config.mjs env.d.ts tsconfig.json wrangler.jsonc package-lock.json
git commit -m "build(astro): swap Vite for Astro + Cloudflare adapter"
```

---

### Task 2: Layout + global styles

**Files:**
- Create: `src/layouts/Layout.astro`

**Interfaces:**
- Consumes: `src/index.css` (existing global styles), the head content currently in `index.html`.
- Produces: `Layout.astro` — the HTML document wrapper used by all pages via `<Layout>…</Layout>`.

- [ ] **Step 1: Create `src/layouts/Layout.astro`**

Port the `index.html` `<head>` verbatim (meta, PWA, SEO/OG/Twitter, fonts, the theme-detection inline script) and import the global CSS. The theme inline script stays for now (cookie-based theme is a later plan); it prevents FOUC by reading localStorage before paint.

```astro
---
import '../index.css';
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0A0F0D" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="StreamCup" />
    <title>StreamCup — World Cup 2026 live streams &amp; fixtures</title>
    <meta name="description" content="Watch World Cup 2026 football live streams and follow every fixture, group standings, and result — one fast, no-clutter hub." />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://cup.umuo.app/" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="StreamCup" />
    <meta property="og:title" content="StreamCup — World Cup 2026 live streams &amp; fixtures" />
    <meta property="og:description" content="Live streams and full fixtures for World Cup 2026 — matches, group standings, and results in one place." />
    <meta property="og:url" content="https://cup.umuo.app/" />
    <meta property="og:image" content="https://cup.umuo.app/og.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:locale:alternate" content="zh_CN" />
    <meta property="og:locale:alternate" content="ja_JP" />
    <meta property="og:locale:alternate" content="ko_KR" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="StreamCup — World Cup 2026 live streams &amp; fixtures" />
    <meta name="twitter:description" content="Live streams and full fixtures for World Cup 2026 — matches, group standings, and results in one place." />
    <meta name="twitter:image" content="https://cup.umuo.app/og.jpg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700&family=Hanken+Grotesk:wght@400&display=swap" rel="stylesheet" />
  </head>
  <body class="min-h-screen">
    <script is:inline>
      (() => {
        try {
          const t = localStorage.getItem('theme');
          document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
        } catch (_e) {
          document.documentElement.dataset.theme = 'dark';
        }
      })();
    </script>
    <slot />
  </body>
</html>
```
(`is:inline` keeps Astro from processing/hoisting the theme script so it runs before paint. `<slot/>` is where each page's content goes.)

- [ ] **Step 2: Verify Astro parses the layout**

Run: `npm run typecheck`
Expected: `astro check` reports 0 errors (the layout compiles; it's unused until Task 3 imports it).

- [ ] **Step 3: Commit**

```bash
git add src/layouts/Layout.astro
git commit -m "feat(astro): Layout with ported head + global styles"
```

---

### Task 3: Catch-all SPA island + `/api` route + remove Vite entry

**Files:**
- Create: `src/components/AppIsland.tsx`, `src/pages/[...all].astro`, `src/pages/api/[...route].ts`
- Delete: `index.html`, `src/main.tsx`, `vite.config.ts`

**Interfaces:**
- Consumes: `src/App.tsx` (default export `App`), `LanguageProvider` (`src/i18n`), `ThemeProvider` (`src/theme`), `Layout.astro` (Task 2), `worker/index.ts` (default export with `fetch(request, env, ctx)`).
- Produces: every route renders the SPA; `/api/*` is served by the existing worker.

- [ ] **Step 1: Create the island entry `src/components/AppIsland.tsx`**

Move `main.tsx`'s provider tree here (minus `ReactDOM.createRoot` — Astro hydrates it). Keep the SW registration.

```tsx
import App from '../App';
import { LanguageProvider } from '../i18n';
import { ThemeProvider } from '../theme';

// The whole current SPA, mounted as one client-only island by [...all].astro.
// (Per-page SSR replaces this island page-by-page in later plans.)
export default function AppIsland() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Create the catch-all page `src/pages/[...all].astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import AppIsland from '../components/AppIsland';
// Client-only for now: the SPA reads window.location and manages its own
// routing. Later plans replace matching routes with real SSR pages.
export const prerender = true;
---
<Layout>
  <div id="root"><AppIsland client:only="react" /></div>
</Layout>
```

- [ ] **Step 3: Create the SW registration** — add to `AppIsland.tsx` bottom (moved from main.tsx), guarded to prod + client:

In `src/components/AppIsland.tsx`, add after the component (module scope runs only client-side because the island is `client:only`):
```tsx
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
```
(Dropped `import.meta.env.PROD` guard — `client:only` code never runs at build; register on load. If dev SW interception is a problem, gate on `import.meta.env.PROD` — note if you do.)

- [ ] **Step 4: Create the `/api` catch-all route `src/pages/api/[...route].ts`**

Forward every `/api/*` request to the existing worker's `fetch`, reusing all current caching/adapters verbatim. Bindings come from `locals.runtime`.

```ts
import type { APIRoute } from 'astro';
import worker from '../../../worker/index';

export const prerender = false;

export const ALL: APIRoute = ({ request, locals }) => {
  const { env, ctx } = locals.runtime;
  return worker.fetch(request, env as Parameters<typeof worker.fetch>[1], ctx);
};
```
(The worker's `fetch` only touches `env.CACHE` for `/api/*` requests — the `ASSETS` fallback branch is unreachable here since this route only matches `/api/*`.)

- [ ] **Step 5: Delete the Vite entry files**

```bash
git rm index.html src/main.tsx vite.config.ts
```
(The leaders/news dev middleware lived in `vite.config.ts`; it's no longer needed — `/api/leaders` and `/api/news` are handled by the worker via the Task-4 route. `vitest` reads its config from... — see Step 6.)

- [ ] **Step 6: Move the Vitest config out of the deleted vite.config**

Vitest's config lived in `vite.config.ts` (`test: { globals, environment: 'jsdom', setupFiles, fileParallelism: false }`). Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    fileParallelism: false,
  },
});
```

- [ ] **Step 7: Verify — full build, tests, and a live smoke**

Run: `npm run build`
Expected: `astro check` 0 errors, worker tsc clean, `astro build` emits `dist/_worker.js/` + assets.

Run: `npx vitest run`
Expected: all 349 tests still pass (component/util tests are build-tool-agnostic; the new `vitest.config.ts` supplies the same jsdom/setup).

Live smoke:
```bash
npm run dev
# use the printed port (Astro dev default 4321):
curl -s "http://localhost:4321/api/fifa.world/scoreboard" | head -c 120
curl -s "http://localhost:4321/api/news?leagues=nba&limit=2" | head -c 120
curl -s "http://localhost:4321/fifa.world" | grep -o '<div id="root">'
```
Expected: the two `/api` calls return ESPN JSON (proves `worker.fetch` runs on Astro with the `CACHE` binding via platformProxy); the page curl finds `<div id="root">` (the SPA shell). Load `http://localhost:4321/fifa.world` in a browser → the full SPA renders and works (matches, navigation, live data). If `platformProxy` doesn't expose `CACHE` in dev (KV binding undefined), confirm the `wrangler.jsonc` kv_namespaces block is present and re-run; note the outcome in the report. Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/components/AppIsland.tsx src/pages/[...all].astro src/pages/api/[...route].ts vitest.config.ts
git commit -m "feat(astro): mount SPA as catch-all island + /api via existing worker"
```

---

## Self-Review

**1. Spec coverage (design §4 step 1 "Skeleton"):**
- Astro + Cloudflare adapter replaces Vite in-place → Task 1 ✓
- `Layout.astro` with cookie-driven head → head ported in Task 2; cookie-driven theme/lang is explicitly a LATER plan (§3) — Task 2 keeps the existing localStorage theme script, noted ✓
- Whole SPA as one catch-all island `<App client:only>` → Task 3 (via `AppIsland`) ✓
- `/api` retained via existing worker → Task 3 Step 4 ✓
- Site runs uninterrupted → Task 3 Step 7 smoke ✓
- Data-layer extraction + per-page SSR → explicitly OUT of this plan (next plans), stated in Global Constraints ✓

**2. Placeholder scan:** No TBD/TODO. Config files and route code are given in full. Two steps carry an explicit conditional fallback (Task 1 Step 7 zero-routes build, Task 3 Step 7 platformProxy KV) with the exact alternative + "note in report" — these are genuine integration-verification branches for a new-stack bring-up, not vague placeholders.

**3. Type/interface consistency:** `AppIsland` (default export) is what `[...all].astro` imports. `worker/index.ts`'s `fetch(request, env, ctx)` signature is what the `/api` route calls with `locals.runtime.{env,ctx}`. KV binding is `CACHE` everywhere (env.d.ts, wrangler.jsonc, worker). `Layout` default export imported by `[...all].astro`.

**Note on risk:** This is a new-stack bring-up (Astro + Cloudflare adapter + existing worker). The highest-uncertainty points — `platformProxy` exposing `CACHE` in dev, `worker.fetch` running under Astro's runtime, `astro build` with a single catch-all — all have explicit verification steps (Task 3 Step 7) that surface problems immediately. If any verification fails, that's a real finding to resolve before the next migration plan (data-layer extraction), not something to paper over.
