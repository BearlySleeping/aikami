// scripts/src/lib/test_blackbox/suites/client.e2e.ts
// Client browser tests via Playwright against the local dev server.
// Runs from the unified apps/e2e package.

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { TestSuite } from '../types.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../..');
const E2E_DIR = resolve(PROJECT_ROOT, 'apps/e2e');

export const pwaSuite: TestSuite = {
  name: 'client',
  category: 'service',
  run: async () => {
    console.log('  Running Client Playwright tests from apps/e2e...');

    try {
      execSync('npx playwright test --project=client --reporter=list', {
        cwd: E2E_DIR,
        stdio: 'inherit',
        timeout: 120_000,
        env: {
          ...process.env,
          CI: process.env.CI || 'true',
        },
      });
      console.log('  ✓ Client tests passed');
    } catch {
      throw new Error('Client Playwright tests failed');
    }
  },
};
