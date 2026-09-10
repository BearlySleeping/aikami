// apps/frontend/client/vitest.config.ts
//
// Minimal pilot for a real-Svelte test lane (assessment migration step 3/4).
//
// The Bun lane in test_preload.ts replaces `$state`/`$derived`/`$effect` with
// identity functions, so it cannot observe reactivity. This config runs tests
// in a real Chromium via Vitest Browser Mode with the actual Svelte compiler
// and runtime — no preload, no global module mocks, no application boot.
//
// Deliberately standalone: it does not import the SvelteKit vite config, so it
// only loads the aliases a component/ViewModel test needs. Keep it that way.

import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const rootDirectory = fileURLToPath(new URL('.', import.meta.url));
const packagesDirectory = fileURLToPath(new URL('../../../packages/', import.meta.url));

const shared = (path: string): string => `${packagesDirectory}shared/${path}`;
const frontend = (path: string): string => `${packagesDirectory}frontend/${path}`;
const clientSource = (path: string): string => `${rootDirectory}src/${path}`;

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: [
      // Narrow and wildcard entries must precede the package root.
      {
        find: /^@aikami\/frontend\/services\/base$/,
        replacement: frontend('services/src/base.ts'),
      },
      {
        find: /^@aikami\/frontend\/services\/(.*)$/,
        replacement: frontend('services/src/lib/$1'),
      },
      {
        find: /^@aikami\/frontend\/services$/,
        replacement: frontend('services/src/index.ts'),
      },
      { find: /^@aikami\/frontend\/utils$/, replacement: frontend('utils/src/index.ts') },
      { find: /^@aikami\/utils$/, replacement: shared('utils/src/index.ts') },
      { find: /^@aikami\/types$/, replacement: shared('types/src/index.ts') },
      { find: /^@aikami\/schemas$/, replacement: shared('schemas/src/index.ts') },
      { find: /^@aikami\/constants$/, replacement: shared('constants/src/index.ts') },
      { find: /^\$logger$/, replacement: shared('logger/src/lib/logger_browser.ts') },
      { find: /^\$types$/, replacement: clientSource('lib/types/index.ts') },
      { find: /^\$lib\/(.*)$/, replacement: clientSource('lib/$1') },
    ],
  },
  test: {
    // Keep this lane strictly separate from the Bun *.test.ts files under
    // src/lib — those import Bun's test API and must never be collected here.
    include: ['src/browser_tests/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      headless: true,
    },
  },
});
