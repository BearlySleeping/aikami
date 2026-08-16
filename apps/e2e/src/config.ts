// apps/e2e/src/config.ts
// Hardcoded emulator port constants for Playwright runtime files.
//
// These values mirror packages/shared/constants/src/lib/development_ports.ts
// but are duplicated here because Playwright loads source files as ESM via
// its bundled Bun loader, which cannot import CJS monorepo packages.
//
// Update both files together if port allocations change.

// Set by scripts/src/lib/herdr/session.ts / herdr_adapter.ts for
// contract-scoped pipeline runs — same offset formula as
// packages/shared/constants/src/lib/development_ports.ts's
// contractPortOffset(), so this lands on the identical value independently
// (can't import that helper here either, same CJS-loader constraint above).
// 0 for a manual, non-contract test run.
const emulatorPortOffset = Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0);

/** Firebase emulator ports for Aikami (must match development_ports.ts).
 *  `voice` stays on its shared base port — it's a singleton backend, never
 *  duplicated per contract (see OFFSET_AWARE_SERVICES in session.ts). */
export const EMULATOR_PORTS = {
  auth: 9098 + emulatorPortOffset,
  firestore: 8081 + emulatorPortOffset,
  functions: 5003 + emulatorPortOffset,
  hosting: 5002 + emulatorPortOffset,
  pubsub: 8086 + emulatorPortOffset,
  storage: 9198 + emulatorPortOffset,
  emulatorHub: 4401 + emulatorPortOffset,
  client: 5274 + emulatorPortOffset,
  voice: 8089,
} as const;

/**
 * Emulator GCP project ID. Offset the same way as EMULATOR_PORTS above (and
 * must match withProjectIdOffset in packages/shared/constants/src/lib/project.ts,
 * same CJS-loader constraint — can't import it here) so a contract-scoped
 * test run connects to its own Firebase emulator instance's project instead
 * of colliding with a concurrently-running contract's.
 */
export const EMULATOR_PROJECT_ID =
  emulatorPortOffset > 0
    ? (`demo-aikami-emulator-${emulatorPortOffset}` as const)
    : ('demo-aikami-emulator' as const);

/** Test API key for the Firebase Auth emulator (fake, emulator-only). */
export const FIREBASE_API_KEY = 'fake-api-key' as const;
