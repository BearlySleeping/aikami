// apps/e2e/src/global_teardown.ts
// Global Playwright teardown: purges Firebase emulator data after all suites
// complete, resetting world state for the next run.
//
// Mirrors global_setup.ts — guarantees zero state bleed between test runs.

import { EMULATOR_PORTS, EMULATOR_PROJECT_ID } from '@aikami/constants';

const FIRESTORE_PORT = EMULATOR_PORTS.firestore;
const AUTH_PORT = EMULATOR_PORTS.auth;
const PROJECT_ID = EMULATOR_PROJECT_ID;

/**
 * Sends a delete request to the specified URL.
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
 * Global Playwright teardown hook.
 * Resets emulator state after all suites finish.
 */
const globalTeardown = async (): Promise<void> => {
  console.log('\n🧹 Global Teardown: Purging Firebase emulator data...');
  await Promise.all([purgeFirestore(), purgeAuth()]);
  console.log('✓ Global teardown complete\n');
};

export default globalTeardown;
