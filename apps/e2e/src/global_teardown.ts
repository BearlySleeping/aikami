// apps/e2e/src/global_teardown.ts
// Playwright global teardown — purge emulator data, then stop only the
// servers the preflight spawned itself (see services/server_registry.ts).
// herdr tabs are deliberately left running: they outlive a single test run.

import { clearAllEmulatorData } from './emulator_helper';
import { stopSpawnedServers } from './services/server_registry';

/**
 * Playwright global teardown hook.
 * 1. Resets emulator state so the next run starts clean.
 * 2. Stops self-spawned (non-herdr) serve processes from the preflight.
 */
const globalTeardown = async (): Promise<void> => {
  console.log('\n🧹 Global Teardown: Purging emulator data...');
  await clearAllEmulatorData();
  stopSpawnedServers();
  console.log('✓ Global teardown complete\n');
};

export default globalTeardown;
