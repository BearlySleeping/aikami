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

/** Dev server ports for Aikami (must match development_ports.ts).
 *  `voice` stays on its shared base port — it's a singleton backend, never
 *  duplicated per contract (see OFFSET_AWARE_SERVICES in session.ts). */
export const EMULATOR_PORTS = {
  client: 5274 + emulatorPortOffset,
  hub: 5276 + emulatorPortOffset,
  site: 5280 + emulatorPortOffset,
  voice: 8089,
} as const;
