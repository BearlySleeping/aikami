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
  emulatorHub: 4401,
} as const;

// ── Aikami ───────────────────────────────────────────────────────────────

export const EMULATOR_PORTS = {
  ...FB_EMULATOR_PORTS,

  // Aikami app dev servers (emulator):
  client: 5274,
  site: 5280,
  hub: 5276,
  voice: 8089,
  image: 8188,
  text: 11434,
} as const;

export const STAGING_PORTS = {
  client: 5273,
  site: 5281,
  hub: 5275,
  voice: 8088,
  image: 8187,
  text: 11433,
} as const;

export const PRODUCTION_PORTS = {
  client: 5277,
  site: 5282,
  hub: 5279,
  voice: 8092,
  image: 8193,
  text: 11435,
} as const;

export const PORTS = {
  emulator: EMULATOR_PORTS,
  staging: STAGING_PORTS,
  production: PRODUCTION_PORTS,
  testing: EMULATOR_PORTS,
} as const;

// ── Per-contract port offsets ───────────────────────────────────────────
//
// Multiple `bun run contract C-XXX` pipelines can run concurrently, each in
// its own herdr workspace. Without this, every contract's dev servers (and
// the Firebase emulator suite) fight over the same fixed ports above. The
// offset is a pure function of the contract ID so every consumer (dev
// service tabs, pi worker/review tabs, cleanup) computes the same value
// independently — no shared allocation table or IPC needed.

export const CONTRACT_PORT_SLOTS = 200;
export const CONTRACT_PORT_STEP = 10;

/** 0 for non-contract workspaces — manual dev keeps today's exact ports. */
export const contractPortOffset = (contractId: string | undefined): number => {
  if (!contractId) {
    return 0;
  }
  const num = Number(contractId.match(/\d+/)?.[0] ?? 0);
  return ((num % CONTRACT_PORT_SLOTS) + 1) * CONTRACT_PORT_STEP;
};

export const withPortOffset = <T extends Record<string, number>>(ports: T, offset: number): T =>
  Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, v + offset])) as T;
