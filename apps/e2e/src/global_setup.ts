// apps/e2e/src/global_setup.ts
// Playwright global setup — purges all emulator databases before tests run.
// Executed once before any test files.
//
// C-054 AC-3: Uses shared emulator_helper for REST API purging.

import { clearAllWorkerProjects } from './emulator_helper';

/**
 * Playwright global setup hook.
 * Purges emulator state for ALL worker projects so tests start
 * with deterministic, empty databases for every worker.
 */
const globalSetup = async (): Promise<void> => {
  console.log('\n🧹 Global Setup: Purging all worker emulator projects...');
  await clearAllWorkerProjects();
  console.log('✓ Global setup complete\n');
};

export default globalSetup;
