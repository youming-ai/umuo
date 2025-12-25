// @ts-check

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://umuo.ai',
  output: 'static',
  // Cloudflare Pages doesn't require adapter for static sites
  // Uncomment and configure when using Cloudflare Functions:
  // adapter: cloudflare({
  //   mode: 'directory',
  //   functionPerRoute: false
  // }),
  integrations: [
    react({
      jsxImportSource: 'react',
      jsxRuntime: 'automatic',
    }),
    tailwind({
      applyBaseStyles: false,
    }),
    sitemap({
      customPages: [
        'https://umuo.ai/search',
        'https://umuo.ai/compare',
        'https://umuo.ai/deals',
        'https://umuo.ai/alerts',
        'https://umuo.ai/profile',
      ],
    }),
  ],
  vite: {
    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
  },
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
    },
    domains: ['umuo.ai', 'cdn.umuo.ai', 'images.unsplash.com'],
  },
});
