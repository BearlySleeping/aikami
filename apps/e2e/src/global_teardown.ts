// apps/e2e/src/global_teardown.ts
// Playwright global teardown — purges all emulator databases after all suites
// complete, resetting world state for the next run.
//
// C-054 AC-3: Uses shared emulator_helper for REST API purging.

import { clearAllWorkerProjects } from './emulator_helper';

/**
 * Playwright global teardown hook.
 * Resets emulator state for ALL worker projects after all suites finish.
 */
const globalTeardown = async (): Promise<void> => {
  console.log('\n🧹 Global Teardown: Purging all worker emulator projects...');
  await clearAllWorkerProjects();
  console.log('✓ Global teardown complete\n');
};

export default globalTeardown;
