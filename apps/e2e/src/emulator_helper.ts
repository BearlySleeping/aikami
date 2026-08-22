// apps/e2e/src/emulator_helper.ts
// Emulator data management utilities for Playwright global lifecycle hooks.
//
// The Firebase Emulator Suite was removed (C-426) — the hub now uses
// Cloudflare D1 + Better Auth, and the client uses local SQLite. There is no
// shared emulator database to purge, so these hooks are no-ops that keep the
// global lifecycle contract intact.

/**
 * Clear ALL emulator data. No-op — the Firebase emulator was removed.
 */
export const clearAllEmulatorData = async (_projectId?: string): Promise<void> => {
  console.log('[e2e:lifecycle] No emulator data to purge (Firebase emulator removed)');
};
