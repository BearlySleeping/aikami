// ── Port Allocation ──────────────────────────────────────────────────────
//
//   Range       Owner      Purpose
//   ─────       ─────      ───────
//   3000-3009   Nordclaw   Internal services (edge-proxy, audit-worker)
//   4400        Nordclaw   Firebase emulator hub
//   4401        Aikami     Firebase emulator hub
//   5000-5001   Nordclaw   Firebase emulator (hosting, functions)
//   5002-5003   Aikami     Firebase emulator (hosting, functions)
//   5170-5189   Nordclaw   Frontend app dev servers (admin=5172, pwa=5174, landing=5176, extension=5179)
//   5270-5289   Aikami     Frontend app dev servers (pwa=5274, game=5276)
//   8080        Nordclaw   Firebase emulator (firestore)
//   8081        Aikami     Firebase emulator (firestore)
//   8085        Nordclaw   Firebase emulator (pubsub)
//   8086        Aikami     Firebase emulator (pubsub)
//   9099        Nordclaw   Firebase emulator (auth)
//   9098        Aikami     Firebase emulator (auth)
//   9199        Nordclaw   Firebase emulator (storage)
//   9198        Aikami     Firebase emulator (storage)
//   9399        Nordclaw   Firebase emulator (dataconnect)
//   9398        Aikami     Firebase emulator (dataconnect)
//
//   Within each project range, even ports = emulator mode, odd = staging,
//   offset +4 = production.
//
//   Aikami apps:  pwa=5274  game=5276

// ── Firebase Emulator (unique for Aikami) ────────────────────────────────

const FB_EMULATOR_PORTS = {
  auth: 9098,
  firestore: 8081,
  functions: 5003,
  hosting: 5002,
  pubsub: 8086,
  storage: 9198,
  dataconnect: 9398,
  emulatorHub: 4401,
} as const;

// ── Aikami ───────────────────────────────────────────────────────────────

export const EMULATOR_PORTS = {
  ...FB_EMULATOR_PORTS,

  // Aikami frontend apps (emulator):
  pwa: 5274,
  game: 5276,
} as const;

export const STAGING_PORTS = {
  pwa: 5273,
  game: 5275,
} as const;

export const PRODUCTION_PORTS = {
  pwa: 5277,
  game: 5278,
} as const;

export const PORTS = {
  emulator: EMULATOR_PORTS,
  staging: STAGING_PORTS,
  production: PRODUCTION_PORTS,
} as const;
