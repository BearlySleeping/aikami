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
  pwa: 5274,
  game: 5276,
} as const;

/** Emulator GCP project ID. */
export const EMULATOR_PROJECT_ID = 'demo-aikami-emulator' as const;
