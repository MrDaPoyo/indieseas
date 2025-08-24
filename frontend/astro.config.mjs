// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  output: 'server',

  adapter: node({
    mode: 'standalone',
  }),

  server: {
    allowedHosts: ['localhost', '127.0.0.1', 'indieseas.net']
  },

  integrations: [svelte()]
});