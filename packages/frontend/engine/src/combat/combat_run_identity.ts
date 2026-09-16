// packages/frontend/engine/src/combat/combat_run_identity.ts
//
// Execution identity for a v2 encounter run.
//
// The pure kernel can only derive a run id from `(encounterId, seed)`, so a
// deterministic RETRY — which intentionally preserves the seed — would reuse
// the same engine run id. That undermines the reaction/settlement cross-run
// safeguards. Execution identity is therefore allocated HERE, outside the pure
// kernel, persisted with the combat save, and restored verbatim (a replay
// preserves a recorded run id; a new attempt gets a new one).
//
// Contract: C-532 AC-3, AC-6
//
// Uniqueness across processes: a process-wide nonce is minted once, so an id
// allocated by a restarted process can never collide with a run id read back
// from a save produced by the previous process.

import { ENCOUNTER_RUN_ID_MAX_LENGTH } from '@aikami/schemas';
import type { World } from 'bitecs';

/** Process-wide nonce — one per process, never persisted. */
const PROCESS_NONCE = Math.random().toString(36).slice(2, 8);

/** Per-world nonce, so two worlds in one process never mint the same id. */
const worldNonce = new WeakMap<World, string>();

const nonceFor = (world: World): string => {
  const existing = worldNonce.get(world);
  if (existing !== undefined) {
    return existing;
  }
  const created = `${PROCESS_NONCE}${Math.random().toString(36).slice(2, 6)}`;
  worldNonce.set(world, created);
  return created;
};

/** The next sequence number to hand out per `(world, encounterId)`. */
const nextSequence = new WeakMap<World, Map<string, number>>();
/** The most recently allocated id per `(world, encounterId)`. */
const currentRunId = new WeakMap<World, Map<string, string>>();

const sequenceMap = (world: World, create: boolean): Map<string, number> | undefined => {
  const existing = nextSequence.get(world);
  if (existing !== undefined) {
    return existing;
  }
  if (!create) {
    return undefined;
  }
  const created = new Map<string, number>();
  nextSequence.set(world, created);
  return created;
};

const currentMap = (world: World, create: boolean): Map<string, string> | undefined => {
  const existing = currentRunId.get(world);
  if (existing !== undefined) {
    return existing;
  }
  if (!create) {
    return undefined;
  }
  const created = new Map<string, string>();
  currentRunId.set(world, created);
  return created;
};

/**
 * Formats a bounded run identity.
 *
 * Keeps the canonical `run:` prefix and the encounter id prefix so a log line
 * is legible, and appends the process nonce plus the per-encounter sequence.
 */
const formatEncounterRunId = (encounterId: string, sequence: number, bucket: string): string => {
  const suffix = `:${bucket}:${PROCESS_NONCE}:${sequence}`;
  const prefix = 'run:';
  const budget = ENCOUNTER_RUN_ID_MAX_LENGTH - prefix.length - suffix.length;
  const trimmed = budget > 0 ? encounterId.slice(0, budget) : '';
  return `${prefix}${trimmed}${suffix}`;
};

/** The current run identity for this world + encounter, if one was allocated. */
export const peekEncounterRunId = (world: World, encounterId: string): string | null =>
  currentMap(world, false)?.get(encounterId) ?? null;

/**
 * Returns the current run identity, allocating a fresh one when this
 * `(world, encounterId)` has none yet.
 *
 * A retry resets the identity first ({@link resetEncounterRunId}), so the next
 * projection of the same encounter allocates a NEW id rather than replaying the
 * previous attempt's.
 */
export const getOrAllocateEncounterRunId = (world: World, encounterId: string): string => {
  const current = currentMap(world, true);
  if (current === undefined) {
    // Defensive: the WeakMap insert cannot fail, but keep the type narrow.
    return formatEncounterRunId(encounterId, 1, 'r');
  }
  const existing = current.get(encounterId);
  if (existing !== undefined) {
    return existing;
  }
  const sequences = sequenceMap(world, true);
  const sequence = (sequences?.get(encounterId) ?? 0) + 1;
  sequences?.set(encounterId, sequence);
  const allocated = formatEncounterRunId(
    encounterId,
    sequence,
    `r${sequence % 1000}:${nonceFor(world)}`,
  );
  current.set(encounterId, allocated);
  return allocated;
};

/**
 * Forgets this encounter's run identity so the next allocation is a NEW run.
 * Called on encounter end and before a retry.
 */
export const resetEncounterRunId = (world: World, encounterId: string): void => {
  currentMap(world, false)?.delete(encounterId);
};

/** Forgets every run identity for this world (teardown / test isolation). */
export const clearEncounterRunIds = (world: World): void => {
  nextSequence.delete(world);
  currentRunId.delete(world);
  worldNonce.delete(world);
};
