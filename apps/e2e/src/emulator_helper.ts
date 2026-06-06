// apps/e2e/src/emulator_helper.ts
// Emulator data management utilities for Playwright global lifecycle hooks.
// Uses Firebase Emulator Suite REST APIs for deterministic database purging.
//
// C-054 AC-3: Extracted from global_setup.ts / global_teardown.ts.

import { EMULATOR_PORTS, EMULATOR_PROJECT_ID } from './config';

/** Firestore emulator host without protocol prefix (for Admin SDK). */
export const FIRESTORE_EMULATOR_HOST = `127.0.0.1:${EMULATOR_PORTS.firestore}` as const;

/** Auth emulator host without protocol prefix (for Admin SDK). */
export const AUTH_EMULATOR_HOST = `127.0.0.1:${EMULATOR_PORTS.auth}` as const;

/** Full Firestore emulator REST base URL. */
const FIRESTORE_REST_BASE = `http://${FIRESTORE_EMULATOR_HOST}` as const;

/** Full Auth emulator REST base URL. */
const AUTH_REST_BASE = `http://${AUTH_EMULATOR_HOST}` as const;

// ── Internal helper ──────────────────────────────────────────

/**
 * Sends a DELETE request to the given URL, logging the result.
 * Non-2xx responses are logged as warnings (emulator may be down).
 */
const _purgeEndpoint = async (url: string, label: string): Promise<void> => {
  // biome-ignore lint/suspicious/noConsole: lifecycle logging for emulator purge
  console.log(`  Purging ${label}: ${url}`);
  try {
    const resp = await fetch(url, {
      method: 'DELETE',
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok && resp.status !== 404) {
      // biome-ignore lint/suspicious/noConsole: lifecycle warning
      console.warn(`  ⚠ ${label} purge returned ${resp.status}: ${resp.statusText}`);
    } else {
      // biome-ignore lint/suspicious/noConsole: lifecycle logging
      console.log(`  ✓ ${label} purged`);
    }
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: lifecycle warning
    console.warn(`  ⚠ ${label} purge failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};

// ── Public API ───────────────────────────────────────────────

/**
 * Clear all Firestore documents via the emulator REST API.
 */
export const clearFirestoreEmulatorData = async (): Promise<void> => {
  const url = `${FIRESTORE_REST_BASE}/emulator/v1/projects/${EMULATOR_PROJECT_ID}/databases/(default)/documents`;
  await _purgeEndpoint(url, 'Firestore');
};

/**
 * Clear all Auth emulator users via the REST API.
 */
export const clearAuthEmulatorData = async (): Promise<void> => {
  const url = `${AUTH_REST_BASE}/emulator/v1/projects/${EMULATOR_PROJECT_ID}/accounts`;
  await _purgeEndpoint(url, 'Auth');
};

/**
 * Clear ALL emulator data (Firestore + Auth).
 * Called from global setup and teardown hooks.
 */
export const clearAllEmulatorData = async (): Promise<void> => {
  // biome-ignore lint/suspicious/noConsole: lifecycle logging
  console.log('[e2e:lifecycle] Purging all emulator data');

  const results = await Promise.allSettled([clearFirestoreEmulatorData(), clearAuthEmulatorData()]);

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    // biome-ignore lint/suspicious/noConsole: lifecycle warning
    console.warn(
      `[e2e:lifecycle] ${failed.length} purge operation(s) failed:`,
      failed.map((r) => (r as PromiseRejectedResult).reason),
    );
  } else {
    // biome-ignore lint/suspicious/noConsole: lifecycle logging
    console.log('[e2e:lifecycle] All emulator data purged successfully');
  }
};
