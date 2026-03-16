// packages/frontend/components/vite.config.ts

import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src'),
      '$lib/*': resolve(__dirname, 'src/*'),
    },
  },
  optimizeDeps: {
    include: ['svelte'],
  },
  build: {
    rollupOptions: {
      external: [],
    },
  },
});
