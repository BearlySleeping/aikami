// scripts/src/lib/test_blackbox/suites/schema_check.ts
// Validate Zod schemas and TypeScript types compile correctly.

import { resolve } from 'node:path';
import type { TestSuite } from '../types.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SCHEMAS_DIR = resolve(PROJECT_ROOT, 'packages/shared/schemas');

export const schemaCheckSuite: TestSuite = {
  name: 'schema-check',
  category: 'validation',
  run: async () => {
    console.log('  Running typecheck on packages/shared/schemas...');
    const proc = Bun.spawn({
      cmd: ['bun', 'run', 'typecheck'],
      cwd: SCHEMAS_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Timeout after 30s
    const timer = setTimeout(() => { proc.kill(); }, 30_000);

    const exitCode = await proc.exited;
    clearTimeout(timer);

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Schema typecheck failed with code ${exitCode}: ${stderr.slice(0, 200)}`);
    }

    console.log('  ✓ Schema typecheck passed');
  },
};
