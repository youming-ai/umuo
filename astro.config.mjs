// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
  }),
  // Sessions are unused; point at unstorage's no-op `null` driver (object form,
  // not the deprecated string signature) so the Cloudflare adapter does not
  // auto-provision a SESSION KV binding.
  session: { driver: { entrypoint: 'unstorage/drivers/null' } },
  integrations: [react()],
});
