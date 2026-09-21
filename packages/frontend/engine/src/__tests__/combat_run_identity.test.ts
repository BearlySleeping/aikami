// packages/frontend/engine/src/__tests__/combat_run_identity.test.ts
//
// Review F6: execution identity is allocated OUTSIDE the pure kernel, so a
// deterministic retry (same encounter id + seed) is still a distinct run.
//
// Contract: C-532 AC-3, AC-6

import { describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import {
  clearEncounterRunIds,
  getOrAllocateEncounterRunId,
  peekEncounterRunId,
  resetEncounterRunId,
} from '../combat/combat_run_identity.ts';

const fakeWorld = (): World => ({}) as World;

describe('review F6: execution run identity', () => {
  it('allocates a stable id for one exposed run', () => {
    const world = fakeWorld();
    const first = getOrAllocateEncounterRunId(world, 'emberwatch/proof');
    const second = getOrAllocateEncounterRunId(world, 'emberwatch/proof');
    expect(second).toBe(first);
    expect(peekEncounterRunId(world, 'emberwatch/proof')).toBe(first);
  });

  it('gives a retry a NEW id from the same encounter + seed', () => {
    const world = fakeWorld();
    const first = getOrAllocateEncounterRunId(world, 'emberwatch/proof');
    // A retry resets the identity, exactly as `retryEncounter` does.
    resetEncounterRunId(world, 'emberwatch/proof');
    const second = getOrAllocateEncounterRunId(world, 'emberwatch/proof');
    expect(second).not.toBe(first);
  });

  it('never collides across a keyed bucket', () => {
    const world = fakeWorld();
    const a = getOrAllocateEncounterRunId(world, 'enc/a');
    const b = getOrAllocateEncounterRunId(world, 'enc/b');
    expect(a).not.toBe(b);
  });

  it('stays inside the canonical wire bound', () => {
    const world = fakeWorld();
    const id = getOrAllocateEncounterRunId(world, 'x'.repeat(400));
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it('keeps two worlds isolated', () => {
    const worldA = fakeWorld();
    const worldB = fakeWorld();
    const a = getOrAllocateEncounterRunId(worldA, 'emberwatch/proof');
    const b = getOrAllocateEncounterRunId(worldB, 'emberwatch/proof');
    expect(a).not.toBe(b);
    clearEncounterRunIds(worldA);
    expect(peekEncounterRunId(worldA, 'emberwatch/proof')).toBeNull();
    expect(peekEncounterRunId(worldB, 'emberwatch/proof')).toBe(b);
  });
});
