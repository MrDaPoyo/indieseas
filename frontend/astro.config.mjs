// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  integrations: [svelte()],
  server: {
    allowedHosts: ['localhost', '127.0.0.1', 'indieseas.net']
  }
});