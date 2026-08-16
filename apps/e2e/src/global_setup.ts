// apps/e2e/src/global_setup.ts
// Playwright global setup — purges all emulator databases before tests run.
// Executed once before any test files.
//
// C-054 AC-3: Uses shared emulator_helper for REST API purging.

import { clearAllEmulatorData } from './emulator_helper';

/**
 * Playwright global setup hook.
 * Purges emulator state so tests start with a deterministic, empty
 * database for every worker.
 */
const globalSetup = async (): Promise<void> => {
  console.log('\n🧹 Global Setup: Purging emulator data...');
  await clearAllEmulatorData();
  console.log('✓ Global setup complete\n');
};

export default globalSetup;
