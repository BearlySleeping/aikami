// apps/e2e/src/config.ts
// Hardcoded emulator port constants for Playwright runtime files.
//
// These values mirror packages/shared/constants/src/lib/development_ports.ts
// but are duplicated here because Playwright loads source files as ESM via
// its bundled Bun loader, which cannot import CJS monorepo packages.
//
// Update both files together if port allocations change.

/** Firebase emulator ports for Aikami (must match development_ports.ts). */
export const EMULATOR_PORTS = {
  auth: 9098,
  firestore: 8081,
  functions: 5003,
  hosting: 5002,
  pubsub: 8086,
  storage: 9198,
  dataconnect: 9398,
  emulatorHub: 4401,
  client: 5274,
  voice: 8089,
} as const;

/** Emulator GCP project ID (base, worker-agnostic). */
export const EMULATOR_PROJECT_ID = 'demo-aikami-emulator' as const;

/** Number of max parallel workers for multi-project teardown. */
export const MAX_WORKERS = 8;

/**
 * Returns a worker-specific emulator project ID for data isolation.
 *
 * Playwright sets `TEST_WORKER_INDEX` per worker (0, 1, 2, ...).
 * Using different project IDs ensures parallel workers don't mutate
 * each other's Firestore/Auth emulator state.
 */
export const getWorkerProjectId = (workerIndex?: string | number): string => {
  const idx = workerIndex ?? process.env.TEST_WORKER_INDEX ?? '0';
  return `demo-aikami-worker-${idx}`;
};
