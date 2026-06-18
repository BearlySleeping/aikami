// ── Port Allocation ──────────────────────────────────────────────────────
//
//   Range       Owner      Purpose
//   ─────       ─────      ───────
//   3000-3009   Nordclaw   Internal services (edge-proxy, audit-worker)
//   4400        Nordclaw   Firebase emulator hub
//   4401        Aikami     Firebase emulator hub
//   5000-5001   Nordclaw   Firebase emulator (hosting, functions)
//   5002-5003   Aikami     Firebase emulator (hosting, functions)
//   5170-5189   Nordclaw   Frontend app dev servers (admin=5172, client=5174, landing=5176, extension=5179)
//   5270-5289   Aikami     Frontend app dev servers (client=5274)
//   8080        Nordclaw   Firebase emulator (firestore)
//   8081        Aikami     Firebase emulator (firestore)
//   8085        Nordclaw   Firebase emulator (pubsub)
//   8086        Aikami     Firebase emulator (pubsub)
//   8087-8092   Aikami     Backend services (voice=8089)
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
//   Aikami apps:  client=5274  voice=8089

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

  // Aikami app dev servers (emulator):
  client: 5274,
  voice: 8089,
  image: 8188,
  text: 11434,
} as const;

export const STAGING_PORTS = {
  client: 5273,
  voice: 8088,
  image: 8187,
  text: 11433,
} as const;

export const PRODUCTION_PORTS = {
  client: 5277,
  voice: 8092,
  image: 8193,
  text: 11435,
} as const;

export const PORTS = {
  emulator: EMULATOR_PORTS,
  staging: STAGING_PORTS,
  production: PRODUCTION_PORTS,
} as const;
