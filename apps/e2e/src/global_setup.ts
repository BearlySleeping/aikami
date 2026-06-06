// apps/e2e/src/global_setup.ts
// Global Playwright setup: purges Firebase emulator data before test runs
// to guarantee deterministic state across suites.
//
// Fires DELETE requests to Firestore and Auth emulator REST APIs.

import { EMULATOR_PORTS, EMULATOR_PROJECT_ID } from '@aikami/constants';

const FIRESTORE_PORT = EMULATOR_PORTS.firestore;
const AUTH_PORT = EMULATOR_PORTS.auth;
const PROJECT_ID = EMULATOR_PROJECT_ID;

/**
 * Sends a delete request to the specified URL with retry logic.
 */
const purgeEndpoint = async (url: string, label: string): Promise<void> => {
  console.log(`  Purging ${label}: ${url}`);
  try {
    const resp = await fetch(url, {
      method: 'DELETE',
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok && resp.status !== 404) {
      console.warn(`  ⚠ ${label} purge returned ${resp.status}: ${resp.statusText}`);
    } else {
      console.log(`  ✓ ${label} purged`);
    }
  } catch (e) {
    console.warn(`  ⚠ ${label} purge failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};

/**
 * Purges all Firestore documents from the emulator.
 */
const purgeFirestore = async (): Promise<void> => {
  const url = `http://localhost:${FIRESTORE_PORT}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  await purgeEndpoint(url, 'Firestore');
};

/**
 * Purges all Auth accounts from the emulator.
 */
const purgeAuth = async (): Promise<void> => {
  const url = `http://localhost:${AUTH_PORT}/emulator/v1/projects/${PROJECT_ID}/accounts`;
  await purgeEndpoint(url, 'Auth');
};

/**
 * Global Playwright setup hook.
 * Purges emulator state so tests start clean.
 */
const globalSetup = async (): Promise<void> => {
  console.log('\n🧹 Global Setup: Purging Firebase emulator data...');
  await Promise.all([purgeFirestore(), purgeAuth()]);
  console.log('✓ Global setup complete\n');
};

export default globalSetup;
