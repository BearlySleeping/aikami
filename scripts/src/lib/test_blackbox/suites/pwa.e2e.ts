// scripts/src/lib/test_blackbox/suites/pwa.e2e.ts
// PWA browser tests via Playwright against the local dev server.

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { TestSuite } from '../types.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../..');
const PWA_DIR = resolve(PROJECT_ROOT, 'apps/frontend/pwa');

export const pwaSuite: TestSuite = {
  name: 'pwa',
  category: 'service',
  run: async () => {
    console.log('  Running Playwright tests...');

    try {
      execSync('bunx playwright test --reporter=list', {
        cwd: PWA_DIR,
        stdio: 'inherit',
        timeout: 120_000,
        env: {
          ...process.env,
          // biome-ignore lint/style/useNamingConvention: env var name
          CI: process.env.CI || 'true', // Ensure non-interactive mode
        },
      });
      console.log('  ✓ PWA tests passed');
    } catch {
      throw new Error('PWA Playwright tests failed');
    }
  },
};
