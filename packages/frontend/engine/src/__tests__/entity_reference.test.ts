// packages/frontend/engine/src/__tests__/entity_reference.test.ts

import { beforeEach, describe, expect, test } from 'bun:test';
import { MAX_ENTITIES } from '../config/memory_config.ts';
import {
  createSafeRef,
  EntityGeneration,
  extractEidFromRef,
  extractGenerationFromRef,
  incrementEntityGeneration,
  resetEntityGenerations,
  resolveSafeRef,
} from '../core/entity_reference.ts';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntityReference — generational indices (C-176)', () => {
  beforeEach(() => {
    resetEntityGenerations();
  });

  // -- Basic create/resolve ------------------------------------------------

  test('createSafeRef returns non-zero for valid eid', () => {
    const ref = createSafeRef(42);
    expect(ref).toBeGreaterThan(0);
  });

  test('createSafeRef returns 0 for eid <= 0', () => {
    expect(createSafeRef(0)).toBe(0);
    expect(createSafeRef(-1)).toBe(0);
  });

  test('createSafeRef returns 0 for eid >= MAX_ENTITIES', () => {
    expect(createSafeRef(MAX_ENTITIES)).toBe(0);
    expect(createSafeRef(MAX_ENTITIES + 1)).toBe(0);
  });

  test('resolveSafeRef returns correct eid for valid reference', () => {
    const ref = createSafeRef(42);
    expect(resolveSafeRef(ref)).toBe(42);
  });

  test('resolveSafeRef returns 0 for invalid input', () => {
    expect(resolveSafeRef(0)).toBe(0);
    expect(resolveSafeRef(-1)).toBe(0);
    expect(resolveSafeRef(Number.NaN)).toBe(0);
    expect(resolveSafeRef(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test('extractEidFromRef returns raw eid', () => {
    const ref = createSafeRef(99);
    expect(extractEidFromRef(ref)).toBe(99);
  });

  test('extractGenerationFromRef returns raw generation', () => {
    // At generation 0, the ref is just the eid
    const ref0 = createSafeRef(5);
    expect(extractGenerationFromRef(ref0)).toBe(0);

    // Increment and check
    incrementEntityGeneration(5);
    const ref1 = createSafeRef(5);
    expect(extractGenerationFromRef(ref1)).toBe(1);
  });

  // -- Generation increment on destruction (AC-1) --------------------------

  test('generation starts at 0', () => {
    expect(EntityGeneration[42]).toBe(0);
  });

  test('incrementEntityGeneration bumps counter by 1', () => {
    incrementEntityGeneration(42);
    expect(EntityGeneration[42]).toBe(1);
  });

  test('multiple increments compound', () => {
    incrementEntityGeneration(42);
    incrementEntityGeneration(42);
    incrementEntityGeneration(42);
    expect(EntityGeneration[42]).toBe(3);
  });

  test('incrementEntityGeneration ignores eid <= 0', () => {
    incrementEntityGeneration(0);
    expect(EntityGeneration[0]).toBe(0);
  });

  test('incrementEntityGeneration ignores eid >= MAX_ENTITIES', () => {
    incrementEntityGeneration(MAX_ENTITIES);
    expect(EntityGeneration[MAX_ENTITIES - 1]).toBe(0);
  });

  // -- ABA rejection (AC-3) ------------------------------------------------

  test('stale reference rejected after generation increment', () => {
    // Create entity A at eid 42, generation 0
    const refA = createSafeRef(42);
    expect(resolveSafeRef(refA)).toBe(42);

    // Destroy entity A (increment generation)
    incrementEntityGeneration(42);

    // Reference to A is now stale
    expect(resolveSafeRef(refA)).toBe(0);
  });

  test('new entity at same eid gets valid reference after recycle', () => {
    // Entity A at eid 42, generation 0
    const refA = createSafeRef(42);

    // Destroy A
    incrementEntityGeneration(42);

    // Entity B recycles eid 42, generation 1
    const refB = createSafeRef(42);
    expect(resolveSafeRef(refB)).toBe(42);

    // Old refA is still stale
    expect(resolveSafeRef(refA)).toBe(0);
  });

  test('ABA: old ref fails, new ref works after double recycle', () => {
    // Gen 0
    const ref0 = createSafeRef(10);
    incrementEntityGeneration(10); // destroy

    // Gen 1
    const ref1 = createSafeRef(10);
    incrementEntityGeneration(10); // destroy again

    // Gen 2
    const ref2 = createSafeRef(10);

    // Only the latest ref (gen 2) is valid
    expect(resolveSafeRef(ref0)).toBe(0);
    expect(resolveSafeRef(ref1)).toBe(0);
    expect(resolveSafeRef(ref2)).toBe(10);
  });

  // -- Safe reference across many entities ---------------------------------

  test('multiple entities tracked independently', () => {
    const ref42 = createSafeRef(42);
    const ref99 = createSafeRef(99);

    // Only destroy 42
    incrementEntityGeneration(42);

    expect(resolveSafeRef(ref42)).toBe(0); // stale
    expect(resolveSafeRef(ref99)).toBe(99); // still valid
  });

  test('reference from different generation resolves correctly', () => {
    // Advance generation of entity 7 to 5
    for (let i = 0; i < 5; i++) {
      incrementEntityGeneration(7);
    }
    expect(EntityGeneration[7]).toBe(5);

    const ref = createSafeRef(7);
    expect(resolveSafeRef(ref)).toBe(7);

    // Reference encodes generation 5
    expect(extractGenerationFromRef(ref)).toBe(5);
  });

  // -- Reset ----------------------------------------------------------------

  test('resetEntityGenerations clears all counters', () => {
    incrementEntityGeneration(42);
    incrementEntityGeneration(99);
    resetEntityGenerations();
    expect(EntityGeneration[42]).toBe(0);
    expect(EntityGeneration[99]).toBe(0);
  });

  // -- Packing mathematical correctness -------------------------------------

  test('packing is reversible for all valid eids', () => {
    for (const eid of [1, 42, 100, 999, 5000, 9999]) {
      const ref = createSafeRef(eid);
      const resolved = resolveSafeRef(ref);
      expect(resolved).toBe(eid);
    }
  });

  test('packing works correctly after generation increments', () => {
    // Advance to generation 100
    for (let i = 0; i < 100; i++) {
      incrementEntityGeneration(42);
    }
    const ref = createSafeRef(42);
    expect(resolveSafeRef(ref)).toBe(42);
    expect(extractEidFromRef(ref)).toBe(42);
    expect(extractGenerationFromRef(ref)).toBe(100);
  });

  test('packing near MAX_ENTITIES boundary', () => {
    const eid = MAX_ENTITIES - 1;
    const ref = createSafeRef(eid);
    expect(resolveSafeRef(ref)).toBe(eid);
  });
});
