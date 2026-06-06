// apps/e2e/src/global_setup.ts
// Playwright global setup — purges all emulator databases before tests run.
// Executed once before any test files.
//
// C-054 AC-3: Uses shared emulator_helper for REST API purging.

import { clearAllEmulatorData } from './emulator_helper';

/**
 * Playwright global setup hook.
 * Purges emulator state so tests start with deterministic, empty databases.
 */
const globalSetup = async (): Promise<void> => {
  // biome-ignore lint/suspicious/noConsole: lifecycle logging
  console.log('\n🧹 Global Setup: Purging Firebase emulator data...');
  await clearAllEmulatorData();
  // biome-ignore lint/suspicious/noConsole: lifecycle logging
  console.log('✓ Global setup complete\n');
};

export default globalSetup;
