// apps/e2e/src/emulator_helper.ts
// Emulator data management utilities for Playwright global lifecycle hooks.
// Uses Firebase Emulator Suite REST APIs for deterministic database purging.
//
// C-054 AC-3: Extracted from global_setup.ts / global_teardown.ts.

import { EMULATOR_PORTS, EMULATOR_PROJECT_ID, getWorkerProjectId, MAX_WORKERS } from './config';

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

// ── Public API ───────────────────────────────────────────────

/**
 * Clear Firestore documents for a specific emulator project.
 */
export const clearFirestoreEmulatorData = async (projectId: string): Promise<void> => {
  const url = `${FIRESTORE_REST_BASE}/emulator/v1/projects/${projectId}/databases/(default)/documents`;
  await _purgeEndpoint(url, `Firestore (${projectId})`);
};

/**
 * Clear Auth emulator accounts for a specific project.
 */
export const clearAuthEmulatorData = async (projectId: string): Promise<void> => {
  const url = `${AUTH_REST_BASE}/emulator/v1/projects/${projectId}/accounts`;
  await _purgeEndpoint(url, `Auth (${projectId})`);
};

/**
 * Clear ALL emulator data (Firestore + Auth) for a single project.
 */
export const clearAllEmulatorData = async (projectId?: string): Promise<void> => {
  const pid = projectId ?? EMULATOR_PROJECT_ID;
  console.log(`[e2e:lifecycle] Purging emulator data for project: ${pid}`);

  const results = await Promise.allSettled([
    clearFirestoreEmulatorData(pid),
    clearAuthEmulatorData(pid),
  ]);

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    console.warn(
      `[e2e:lifecycle] ${failed.length} purge operation(s) failed:`,
      failed.map((r) => (r as PromiseRejectedResult).reason),
    );
  } else {
    console.log(`[e2e:lifecycle] Project ${pid} emulator data purged successfully`);
  }
};

/**
 * Purge emulator data for ALL worker projects.
 *
 * Iterates through MAX_WORKERS project IDs (demo-aikami-worker-0 through
 * demo-aikami-worker-N) and purges each. Called from global setup/teardown
 * to ensure no stale data from previous runs interferes with the current run.
 */
export const clearAllWorkerProjects = async (): Promise<void> => {
  console.log('[e2e:lifecycle] Purging all worker emulator projects');

  for (let i = 0; i < MAX_WORKERS; i++) {
    const pid = getWorkerProjectId(i);
    await clearAllEmulatorData(pid);
  }
  console.log('[e2e:lifecycle] All worker projects purged successfully');
};
