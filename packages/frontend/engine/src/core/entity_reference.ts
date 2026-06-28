// packages/frontend/engine/src/core/entity_reference.ts

import { MAX_ENTITIES } from '../config/memory_config.ts';

// ---------------------------------------------------------------------------
// EntityReference — generational indices for ABA-safe entity references
//
// Contract C-176: Prevents fatal ABA memory corruption when bitECS recycles
// entity IDs during mass map transitions. Wraps a 32-bit entity ID and a
// 32-bit generation counter into a single 64-bit safe reference (JavaScript
// number, which is IEEE 754 Float64 — safe integer range up to 2^53).
//
// Packing formula (no bitwise ops — JS bitwise is 32-bit signed only):
//   safeRef = (generation * MAX_ENTITIES) + eid
//
// Unpacking:
//   eid = safeRef % MAX_ENTITIES
//   generation = Math.floor(safeRef / MAX_ENTITIES)
//
// Generation tracking is a single global Uint32Array where index == EID
// and value == current generation counter. Incremented on entity destruction.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Generation tracking
// ---------------------------------------------------------------------------

/**
 * Global generation counter array.
 *
 * `EntityGeneration[eid]` holds the current generation number for
 * entity slot `eid`. Incremented every time that slot is destroyed
 * and recycled. A safe reference created at generation N becomes
 * invalid when the slot reaches generation N+1 (entity destroyed).
 */
export const EntityGeneration = new Uint32Array(MAX_ENTITIES);

/**
 * Resets all generation counters to zero.
 *
 * Call during full engine teardown to prevent stale generation
 * values from affecting a fresh world.
 */
export const resetEntityGenerations = (): void => {
  EntityGeneration.fill(0);
};

/**
 * Increments the generation counter for a given entity slot.
 *
 * Called when an entity is destroyed. After this, any safe reference
 * created before the increment will fail {@link resolveSafeRef}.
 *
 * @param eid - The entity ID whose generation to increment.
 */
export const incrementEntityGeneration = (eid: number): void => {
  if (eid <= 0 || eid >= MAX_ENTITIES) {
    return;
  }
  EntityGeneration[eid] = (EntityGeneration[eid] + 1) >>> 0; // Wraps at Uint32 max
};

// ---------------------------------------------------------------------------
// Safe reference packing / unpacking
// ---------------------------------------------------------------------------

/**
 * Packing factor for generation-aware entity references.
 *
 * Must match {@link MAX_ENTITIES} so that eid fits cleanly in the
 * lower bits of the reference. Each generation increment adds
 * `MAX_ENTITIES` to the reference value, keeping eid stable in
 * the modulo result.
 */
const PACK_FACTOR = MAX_ENTITIES;

/**
 * Creates a generation-aware safe reference for an entity.
 *
 * The returned number encodes both the current generation and the
 * entity ID. Use {@link resolveSafeRef} to validate and extract
 * the entity ID later.
 *
 * Safe integer range: with MAX_ENTITIES=10000, supports up to
 * 9×10^11 generations before Float64 precision loss.
 *
 * @param eid - The entity ID to reference.
 * @returns A 64-bit safe reference number.
 */
export const createSafeRef = (eid: number): number => {
  if (eid <= 0 || eid >= MAX_ENTITIES) {
    return 0;
  }
  const generation = EntityGeneration[eid];
  return generation * PACK_FACTOR + eid;
};

/**
 * Resolves a safe reference back to an entity ID, validating the
 * generation matches.
 *
 * If the entity has been destroyed and its slot recycled (generation
 * incremented), the reference is stale and this function returns `0`
 * (null sentinel).
 *
 * @param safeRef - The safe reference created by {@link createSafeRef}.
 * @returns The entity ID if the generation matches, or `0` if stale.
 */
export const resolveSafeRef = (safeRef: number): number => {
  if (safeRef <= 0 || !Number.isFinite(safeRef)) {
    return 0;
  }

  const eid = safeRef % PACK_FACTOR;
  const refGeneration = Math.floor(safeRef / PACK_FACTOR);

  if (eid <= 0 || eid >= MAX_ENTITIES) {
    return 0;
  }

  const currentGeneration = EntityGeneration[eid];

  if (refGeneration !== currentGeneration) {
    return 0; // Stale reference — entity was destroyed and recycled
  }

  return eid;
};

/**
 * Extracts the entity ID from a safe reference WITHOUT generation
 * validation.
 *
 * Use ONLY when you've already validated the reference via
 * {@link resolveSafeRef} and need to unpack it elsewhere.
 *
 * @param safeRef - The safe reference.
 * @returns The raw entity ID (no validation).
 */
export const extractEidFromRef = (safeRef: number): number => {
  if (safeRef <= 0) {
    return 0;
  }
  return safeRef % PACK_FACTOR;
};

/**
 * Extracts the generation from a safe reference WITHOUT validation.
 *
 * @param safeRef - The safe reference.
 * @returns The generation counter encoded in the reference.
 */
export const extractGenerationFromRef = (safeRef: number): number => {
  if (safeRef <= 0) {
    return 0;
  }
  return Math.floor(safeRef / PACK_FACTOR);
};
