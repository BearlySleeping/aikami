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
//   8087-8092   Aikami     Backend services (voice=8089, stt=8087)
//   9099        Nordclaw   Firebase emulator (auth)
//   9098        Aikami     Firebase emulator (auth)
//   9199        Nordclaw   Firebase emulator (storage)
//   9198        Aikami     Firebase emulator (storage)
//   5432        (reserved) System PostgreSQL — deliberately NOT used by Aikami
//                         so a developer's own postgres on the default port
//                         can never be confused with ours (C-387)
//   5433        Aikami     Local PostgreSQL (dev) — real engine, Nix-provided
//
//   Within each project range, even ports = emulator mode, odd = staging,
//   offset +4 = production.
//
//   Aikami apps:  client=5274  voice=8089  stt=8087  postgres=5433

// ── Reserved ranges (single source of truth) ─────────────────────────────
// The Nordclaw-owned ranges from the table above, plus the 5432 system
// PostgreSQL reservation, as machine-checkable constants. The port-collision
// test (development_ports.test.ts) asserts that every contract-shifted
// offsettable port stays OUTSIDE these ranges — change STEP/SLOTS and the
// test fails if any shifted port lands inside one. 5432 is deliberately not
// Aikami's (C-387) but is still reserved in the table, so a shifted port
// must never land on a developer's system postgres either.
export const NORDCLAW_RESERVED_RANGES: readonly (readonly [start: number, end: number])[] = [
  [3000, 3009], // Nordclaw internal services (edge-proxy, audit-worker)
  [4400, 4400], // Nordclaw Firebase emulator hub
  [5000, 5001], // Nordclaw Firebase emulator (hosting, functions)
  [5170, 5189], // Nordclaw frontend app dev servers
  [5432, 5432], // system PostgreSQL — reserved, never Aikami's (C-387)
  [8080, 8080], // Nordclaw Firebase emulator (firestore)
  [8085, 8085], // Nordclaw Firebase emulator (pubsub)
  [9099, 9099], // Nordclaw Firebase emulator (auth)
  [9199, 9199], // Nordclaw Firebase emulator (storage)
];

/** First port of the OS ephemeral-port range. Linux's default (32768) is the
 *  lowest start across the platforms Aikami runs on (macOS/Windows default
 *  to 49152), so staying below 32768 keeps every shifted port clear of the
 *  ephemeral range on all three. */
export const EPHEMERAL_PORT_START = 32768;

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
//
// Split into two groups because they behave differently under a per-contract
// port offset (see "Per-contract port offsets" below):
//   OFFSETTABLE — dev servers with a Firebase-adjacent port that collides
//     across concurrent contract pipelines. Shifted by contractPortOffset().
//   FIXED — heavy singleton backends (voice/image/text engines, Postgres)
//     that stay on one shared port regardless of which contract is running.
//     Never shifted — withPortOffset() below leaves these untouched by
//     construction, so a consumer can no longer accidentally look for one
//     of these at a shifted port that nothing is actually listening on.

export const OFFSETTABLE_PORTS = {
  ...FB_EMULATOR_PORTS,
  client: 5274,
  site: 5280,
  hub: 5276,
} as const;

export const FIXED_PORTS = {
  voice: 8089,
  stt: 8087,
  image: 8188,
  text: 11434,

} as const;

export const EMULATOR_PORTS = {
  ...OFFSETTABLE_PORTS,
  ...FIXED_PORTS,
} as const;

export const STAGING_PORTS = {
  client: 5273,
  site: 5281,
  hub: 5275,
  voice: 8088,
  stt: 8086,
  image: 8187,
  text: 11433,
} as const;

export const PRODUCTION_PORTS = {
  client: 5277,
  site: 5282,
  hub: 5279,
  voice: 8092,
  stt: 8090,
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
//
// 🔴 STEP=66 / SLOTS=163 were chosen by brute-force search, not guesswork —
// a naive `offset = slot * step` is deceptively easy to get wrong: the
// previous STEP=10/SLOTS=200 pairing had two live collision classes (proven
// by exhaustive check, see the rig-audit findings F-03):
//   1. Slot wraparound — `num % 200` means C-201 and C-1 land on the exact
//      same offset, so every one of their ports collides outright.
//   2. Cross-port collisions — OFFSETTABLE_PORTS.storage (9198) and .auth
//      (9098) differ by exactly 100 = 10 × STEP, so any two contracts whose
//      slots are 10 apart put one contract's storage port on top of
//      another's auth port. 760 such pairs existed across ids 1..400.
// This STEP/SLOTS pair is verified collision-free — by brute force, not by
// a hand argument — for every (slot, offsettable-port) combination against:
// every other (slot, offsettable-port) combination, the unshifted baseline
// (slot 0 — manual `bun run dev`, which runs permanently alongside any
// number of contract pipelines), every FIXED_PORTS value, and the
// Nordclaw-reserved ranges documented at the top of this file. See the
// brute-force check mirrored in development_ports.test.ts — that test is
// the actual guarantee; this comment is only the summary.
export const CONTRACT_PORT_SLOTS = 163;
export const CONTRACT_PORT_STEP = 66;

/** 0 for non-contract workspaces — manual dev keeps today's exact ports. */
export const contractPortOffset = (contractId: string | undefined): number => {
  if (!contractId) {
    return 0;
  }
  const num = Number(contractId.match(/\d+/)?.[0] ?? 0);
  return ((num % CONTRACT_PORT_SLOTS) + 1) * CONTRACT_PORT_STEP;
};

/** Port names shifted by a contract offset — see OFFSETTABLE_PORTS above. */
const OFFSETTABLE_KEYS = new Set<string>(Object.keys(OFFSETTABLE_PORTS));

/**
 * Shift only the offsettable ports in `ports` by `offset`; FIXED_PORTS keys
 * (voice/stt/image/text/postgres) pass through unchanged even when present
 * in the same object (e.g. the merged EMULATOR_PORTS). This used to shift
 * every key unconditionally, which meant a contract workspace's client
 * would compute e.g. `voice: 8089 + offset` while the voice engine — a
 * shared singleton, deliberately never duplicated per contract — was still
 * listening on the unshifted 8089. apps/e2e/src/config.ts already had to
 * hardcode a workaround for this; this fix makes the workaround unnecessary
 * (kept there regardless, since that file can't import this module — see
 * its own comment).
 */
export const withPortOffset = <T extends Record<string, number>>(ports: T, offset: number): T =>
  Object.fromEntries(
    Object.entries(ports).map(([k, v]) => [k, OFFSETTABLE_KEYS.has(k) ? v + offset : v]),
  ) as T;
