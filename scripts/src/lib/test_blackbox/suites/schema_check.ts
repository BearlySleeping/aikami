// scripts/src/lib/test_blackbox/suites/schema_check.ts
// Validate Zod schemas and TypeScript types compile correctly.

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { TestSuite } from '../types.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../..');
const SCHEMAS_DIR = resolve(PROJECT_ROOT, 'packages/shared/schemas');

export const schemaCheckSuite: TestSuite = {
  name: 'schema-check',
  category: 'validation',
  run: async () => {
    console.log('  Running typecheck on packages/shared/schemas...');
    execSync('bun run typecheck', {
      cwd: SCHEMAS_DIR,
      stdio: 'inherit',
      timeout: 30_000,
    });
    console.log('  ✓ Schema typecheck passed');
  },
};
