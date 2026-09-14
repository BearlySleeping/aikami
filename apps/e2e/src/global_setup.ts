// apps/e2e/src/global_setup.ts
// Playwright global setup — per-run server orchestration, then purge.
// Executed once before any test files.
//
// 1. E2E preflight (src/services/preflight.ts): probe / reuse / build / start
//    exactly the servers the requested --project selection needs. This runs
//    here because Playwright starts `webServer` entries BEFORE globalSetup,
//    so no preflight decision could ever affect them — see the lifecycle
//    comment in playwright.config.ts.
// 2. Purge (C-054 AC-3): reset emulator state after the servers are up, so
//    every run starts with a deterministic, empty database.

import { clearAllEmulatorData } from './emulator_helper';
import { runPreflight } from './services/preflight';

const globalSetup = async (): Promise<void> => {
  const requestedProjects = process.env.E2E_SELECTED_PROJECTS?.split(',').filter(Boolean);
  await runPreflight({ requestedProjects });

  console.log('\n🧹 Global Setup: Purging emulator data...');
  await clearAllEmulatorData();
  console.log('✓ Global setup complete\n');
};

export default globalSetup;
